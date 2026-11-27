# Música del bar (cola con QR)

Los clientes escanean un QR, buscan su canción y se agrega a la cola. La laptop (conectada a la TV por HDMI) reproduce la cola con tu cuenta de YouTube Premium.

## Instalación (una sola vez)
1. Instala Node.js (versión LTS) desde https://nodejs.org
2. Abre esta carpeta en una terminal y ejecuta: `npm install`

## Uso diario
1. En la terminal: `npm start`
2. En la laptop abre **Chrome** con tu cuenta de YouTube Premium iniciada y entra a `http://localhost:3000/player.html`
3. Toca **Iniciar**, pon pantalla completa (F11) y envía la pantalla a la TV por HDMI.
4. Imprime el QR desde `http://localhost:3000/qr.html` y ponlo en las mesas.

Los celulares de los clientes deben estar en el mismo WiFi que la laptop.

## Que los clientes pidan con datos móviles (sin WiFi)
1. Una sola vez, instala el túnel gratuito de Cloudflare: `winget install --id Cloudflare.cloudflared` y abre una ventana NUEVA de PowerShell.
2. Ventana 1: `npm.cmd start` (el servidor).
3. Ventana 2, en la misma carpeta: `npm.cmd run tunel`. Tras unos segundos muestra una dirección `https://....trycloudflare.com`.
4. En el reproductor (`localhost:3000/player.html`) el QR cambia solo a esa dirección. Los clientes lo escanean desde cualquier red.
5. El panel de admin también funciona desde esa dirección, con tu PIN. **Cambia el PIN por uno propio en `config.json`** antes de usarlo así.

Esa dirección cambia cada vez que reinicias el túnel, así que un QR impreso solo sirve ese día. Para una dirección fija: usa un dominio propio con Cloudflare o ngrok (dominio fijo gratis) y ponla en `config.json` como `"publicUrl": "https://tu-direccion"`.

## Panel del dueño
Desde tu celular (mismo WiFi): `http://IP-DE-LA-LAPTOP:3000/admin.html` con el PIN (por defecto 1234). Ahí puedes saltar canciones, quitar pedidos o vaciar la cola. Cambia el PIN en `config.json`.

## Ajustes (config.json)
- `adminPin`: PIN del panel.
- `maxPendingPerClient`: cuántas canciones puede tener en cola cada celular a la vez.
- `maxSeconds`: duración máxima de una canción (evita videos de horas).
- `fallback`: lista de IDs de video de YouTube que suenan cuando la cola está vacía. Ejemplo: `["dQw4w9WgXcQ", "otroID"]`. El ID es lo que va después de `v=` en el enlace.

## Notas
- Algunos videos no permiten reproducirse fuera de YouTube. Si ocurre, el reproductor salta solo al siguiente.
- El QR usa la IP de la laptop. Si el router le cambia la IP, el QR deja de servir: reserva una IP fija para la laptop en el router.
- La búsqueda usa el paquete `yt-search`. Si YouTube cambia su página puede dejar de funcionar y habría que actualizarlo (`npm update`).
- Recuerda que YouTube Premium es para uso personal y un bar necesita licencia de música (APDAYC).
