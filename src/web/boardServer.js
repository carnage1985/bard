// Minimaler HTTP-Server (ohne Dependencies) für das Secret-Hitler-Board.
// Routen (Präfix-agnostisch, damit ein Reverse Proxy frei mappen kann):
//   .../<code>/          HTML
//   .../<code>/state     JSON (öffentliche Sicht)
//   .../<code>/events    SSE Live-Updates
const http = require('http');
const fs = require('fs');
const path = require('path');

const PUBLIC_DIR = path.join(__dirname, 'public');
const ROUTE = /\/([a-f0-9]{12})(\/(state|events|board\.js|board\.css)?)?$/;
const MIME = { 'board.js': 'text/javascript; charset=utf-8', 'board.css': 'text/css; charset=utf-8' };

const views = new Map(); // code -> öffentliche Sicht
const clients = new Map(); // code -> Set<res>

function publish(code, view) {
  views.set(code, view);
  const set = clients.get(code);
  if (!set) return;
  const msg = `data: ${JSON.stringify(view)}\n\n`;
  for (const res of set) res.write(msg);
}

function remove(code) {
  views.delete(code);
  clients.get(code)?.forEach((res) => res.end());
  clients.delete(code);
}

function start({ port, logger = console }) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const m = ROUTE.exec(url.pathname);
    if (!m) { res.writeHead(404).end('Not found'); return; }
    const [, code, tail, what] = m;
    const baseHeaders = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };

    if (!tail) { // /<code> -> /<code>/ (relative Weiterleitung, Präfix bleibt erhalten)
      res.writeHead(301, { Location: `${code}/` }).end();
      return;
    }
    if (what === 'board.js' || what === 'board.css') {
      fs.readFile(path.join(PUBLIC_DIR, what), (err, buf) => {
        if (err) { res.writeHead(404).end(); return; }
        res.writeHead(200, { ...baseHeaders, 'Content-Type': MIME[what] }).end(buf);
      });
      return;
    }
    const view = views.get(code);
    if (!view) { res.writeHead(404, baseHeaders).end('Spiel nicht gefunden'); return; }

    if (what === 'state') {
      res.writeHead(200, { ...baseHeaders, 'Content-Type': 'application/json' }).end(JSON.stringify(view));
    } else if (what === 'events') {
      res.writeHead(200, {
        ...baseHeaders,
        'Content-Type': 'text/event-stream',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.write(`data: ${JSON.stringify(view)}\n\n`);
      if (!clients.has(code)) clients.set(code, new Set());
      clients.get(code).add(res);
      const ping = setInterval(() => res.write(': ping\n\n'), 25000);
      req.on('close', () => { clearInterval(ping); clients.get(code)?.delete(res); });
    } else {
      fs.readFile(path.join(PUBLIC_DIR, 'board.html'), (err, buf) => {
        if (err) { res.writeHead(500).end(); return; }
        res.writeHead(200, { ...baseHeaders, 'Content-Type': 'text/html; charset=utf-8' }).end(buf);
      });
    }
  });
  server.listen(port, () => logger.info(`🌐 Secret-Hitler-Board läuft auf Port ${port}.`, { toDiscord: false }));
  server.on('error', (err) => logger.error('❌ Board-Server Fehler:', err));
  return server;
}

module.exports = { start, publish, remove };
