const express = require('express');
const os = require('os');
const path = require('path');
const fs = require('fs');
const QRCode = require('qrcode');

let yts = null;
try { yts = require('yt-search'); } catch (e) { console.warn('yt-search no instalado: la busqueda no funcionara'); }

function readConfig() {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8')); }
  catch (e) { return {}; }
}
const cfg = Object.assign(
  { port: 3000, adminPin: '1234', maxPendingPerClient: 2, maxSeconds: 600, fallback: [] },
  readConfig()
);

// ---------- Estado en memoria ----------
let queue = [];      // canciones pendientes
let current = null;  // cancion sonando
let seq = 0;         // cambia cada vez que cambia la cancion actual
let fallbackIdx = 0;
let nextId = 1;

function fallbackPick() {
  if (!cfg.fallback.length) return null;
  const id = cfg.fallback[fallbackIdx % cfg.fallback.length];
  fallbackIdx++;
  return { qid: 0, id, title: '(lista base del bar)', thumb: '', by: 'bar' };
}

function advance() {
  current = queue.shift() || fallbackPick() || null;
  seq++;
  return current;
}

// ---------- Utilidades ----------
function lanUrl() {
  // Si pones "lanIp" en config.json, se usa esa IP tal cual
  if (cfg.lanIp) return `http://${cfg.lanIp}:${cfg.port}`;
  const virtual = /vethernet|vmware|virtualbox|vbox|hyper-v|wsl|docker|loopback|bluetooth|tailscale|zerotier/i;
  const nets = os.networkInterfaces();
  const candidates = [];
  for (const name of Object.keys(nets)) {
    if (virtual.test(name)) continue;
    for (const n of nets[name]) {
      if (n.family === 'IPv4' && !n.internal) candidates.push({ name, address: n.address });
    }
  }
  // Prioriza WiFi/Ethernet reales y direcciones que no terminen en .1 (suelen ser virtuales o el router)
  const pref = candidates.find(c => /wi-?fi|wlan|inal|ethernet/i.test(c.name) && !c.address.endsWith('.1'))
    || candidates.find(c => !c.address.endsWith('.1'))
    || candidates[0];
  return `http://${pref ? pref.address : 'localhost'}:${cfg.port}`;
}

// URL publica (tunel). Se puede fijar en config.json ("publicUrl") o la registra tunnel.js al iniciar
let publicUrl = String(cfg.publicUrl || process.env.PUBLIC_URL || '').replace(/\/$/, '');
function baseUrl() { return publicUrl || lanUrl(); }

// Un tunel (cloudflared, ngrok) conecta desde 127.0.0.1 pero agrega cabeceras de reenvio.
// Si vemos esas cabeceras, la peticion viene de internet aunque la IP parezca local.
function viaProxy(req) {
  return !!(req.get('cf-connecting-ip') || req.get('x-forwarded-for') || req.get('forwarded') || req.get('x-real-ip'));
}

function isLocal(req) {
  const ip = req.socket.remoteAddress || '';
  const loopback = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
  return loopback && !viaProxy(req);
}

// Identifica a cada cliente: id guardado en su celular, o su IP real si no lo trae.
// (Con datos moviles muchos celulares pueden compartir IP, por eso se prefiere el id.)
function clientKey(req) {
  const cid = req.get('x-cid');
  if (cid && /^[\w-]{8,64}$/.test(cid)) return 'c:' + cid;
  const ip = req.get('cf-connecting-ip') || (req.get('x-forwarded-for') || '').split(',')[0].trim() || req.ip;
  return 'ip:' + ip;
}

// Proteccion contra adivinar el PIN: 8 fallos bloquean 10 minutos a ese cliente
const pinFails = new Map();
const MAX_FAILS = 8;
const BLOCK_MS = 10 * 60 * 1000;

function isAdmin(req) {
  if (isLocal(req)) return true;
  const pin = req.get('x-pin');
  if (!pin) return false;
  const key = req.get('cf-connecting-ip') || (req.get('x-forwarded-for') || '').split(',')[0].trim() || req.ip;
  const rec = pinFails.get(key) || { n: 0, until: 0 };
  if (rec.until > Date.now()) return false;
  if (pin === String(cfg.adminPin)) { pinFails.delete(key); return true; }
  rec.n++;
  if (rec.n >= MAX_FAILS) { rec.n = 0; rec.until = Date.now() + BLOCK_MS; }
  pinFails.set(key, rec);
  return false;
}

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------- API publica (clientes) ----------
app.get('/api/search', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.json([]);
  if (!yts) return res.status(500).json({ error: 'Busqueda no disponible' });
  try {
    const r = await yts(q);
    const out = r.videos
      .filter(v => v.seconds > 0 && v.seconds <= cfg.maxSeconds)
      .slice(0, 8)
      .map(v => ({
        id: v.videoId,
        title: v.title,
        thumb: v.thumbnail,
        duration: v.timestamp,
        author: v.author && v.author.name
      }));
    res.json(out);
  } catch (e) {
    console.error('Error buscando:', e.message);
    res.status(502).json({ error: 'No se pudo buscar. Intenta de nuevo.' });
  }
});

app.get('/api/state', (req, res) => {
  res.json({ current, seq, queue });
});

app.post('/api/queue', (req, res) => {
  const { id, title, thumb } = req.body || {};
  const by = clientKey(req);
  if (!id || !/^[\w-]{11}$/.test(id)) return res.status(400).json({ error: 'Video invalido' });
  if (queue.some(s => s.id === id) || (current && current.id === id)) {
    return res.status(409).json({ error: 'Esa cancion ya esta en la cola' });
  }
  const mine = queue.filter(s => s.by === by).length;
  if (mine >= cfg.maxPendingPerClient) {
    return res.status(429).json({ error: `Ya tienes ${mine} canciones en cola. Espera a que suene una.` });
  }
  const item = {
    qid: nextId++,
    id,
    title: String(title || 'Sin titulo').slice(0, 120),
    thumb: String(thumb || ''),
    by
  };
  queue.push(item);
  // si no suena nada (o solo suena la lista base), esta pasa a sonar de inmediato
  if (!current || current.qid === 0) advance();
  res.json({ ok: true, position: queue.length });
});

// ---------- API protegida (reproductor local y admin con PIN) ----------
// El reproductor avisa que termino: solo avanza si coincide el seq (evita saltos dobles)
app.post('/api/advance', (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'No autorizado' });
  const { seq: clientSeq } = req.body || {};
  if (clientSeq !== undefined && clientSeq !== seq) return res.json({ current, seq, ignored: true });
  advance();
  res.json({ current, seq });
});

app.post('/api/remove', (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'No autorizado' });
  const { qid } = req.body || {};
  queue = queue.filter(s => s.qid !== qid);
  res.json({ ok: true });
});

app.post('/api/clear', (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'No autorizado' });
  queue = [];
  res.json({ ok: true });
});

app.get('/api/check-pin', (req, res) => {
  res.json({ ok: isAdmin(req) });
});

// ---------- QR ----------
app.get('/api/qr.svg', async (req, res) => {
  try {
    const svg = await QRCode.toString(`${baseUrl()}/pedir.html`, { type: 'svg', margin: 1 });
    res.set('Cache-Control', 'no-store').type('image/svg+xml').send(svg);
  } catch (e) {
    res.status(500).end();
  }
});

app.get('/api/info', (req, res) => {
  res.json({ url: `${baseUrl()}/pedir.html`, internet: !!publicUrl });
});

// Solo desde la propia laptop: tunnel.js registra aqui la direccion publica del tunel
app.post('/api/public-url', (req, res) => {
  if (!isLocal(req)) return res.status(403).json({ error: 'No autorizado' });
  const u = String((req.body || {}).url || '').replace(/\/$/, '');
  if (u && !/^https:\/\/[\w.-]+(:\d+)?$/.test(u)) return res.status(400).json({ error: 'URL invalida' });
  publicUrl = u;
  res.json({ ok: true, url: publicUrl });
});

if (require.main === module) {
  app.listen(cfg.port, '0.0.0.0', () => {
    console.log('==========================================');
    console.log(' Musica del bar lista');
    console.log(` Reproductor (abrelo en la laptop): http://localhost:${cfg.port}/player.html`);
    console.log(` Clientes (el QR apunta aqui):      ${baseUrl()}/pedir.html`);
    console.log(` QR para imprimir:                  http://localhost:${cfg.port}/qr.html`);
    console.log(` Panel admin (PIN ${cfg.adminPin}):            ${baseUrl()}/admin.html`);
    console.log('==========================================');
  });
}

module.exports = app;
