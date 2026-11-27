// Abre un tunel de Cloudflare hacia el servidor local para que los clientes entren con datos moviles.
// Uso: npm.cmd run tunel   (con el servidor ya corriendo en otra ventana)
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

let port = 3000;
try { port = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8')).port || 3000; } catch (e) {}

function registrar(url) {
  const body = JSON.stringify({ url });
  const req = http.request(
    { host: '127.0.0.1', port, path: '/api/public-url', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
    (res) => {
      res.resume();
      if (res.statusCode === 200) {
        console.log('\n==========================================');
        console.log(' Tunel listo. Los clientes pueden entrar con datos moviles.');
        console.log(` Pedidos:  ${url}/pedir.html`);
        console.log(` Admin:    ${url}/admin.html`);
        console.log(' El QR del reproductor ya apunta a esta direccion.');
        console.log(' (Esta direccion cambia cada vez que reinicias el tunel.)');
        console.log('==========================================\n');
      } else {
        console.log('No pude registrar la URL en el servidor (codigo ' + res.statusCode + ').');
      }
    }
  );
  req.on('error', () => console.log('El servidor no esta corriendo. Ejecuta primero: npm.cmd start (en otra ventana)'));
  req.end(body);
}

console.log('Abriendo tunel hacia http://localhost:' + port + ' ...');
const child = spawn('cloudflared', ['tunnel', '--url', 'http://localhost:' + port], { windowsHide: true });

let registrada = false;
function leer(data) {
  const m = String(data).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
  if (m && !registrada) { registrada = true; registrar(m[0]); }
}
child.stdout.on('data', leer);
child.stderr.on('data', leer);

child.on('error', (e) => {
  if (e.code === 'ENOENT') {
    console.log('\nNo encuentro "cloudflared". Instalalo con este comando y abre una ventana NUEVA de PowerShell:');
    console.log('  winget install --id Cloudflare.cloudflared\n');
  } else {
    console.log('Error al abrir el tunel:', e.message);
  }
  process.exit(1);
});

child.on('exit', (code) => {
  console.log('El tunel se cerro (codigo ' + code + ').');
  process.exit(code || 0);
});

process.on('SIGINT', () => { child.kill(); process.exit(0); });
