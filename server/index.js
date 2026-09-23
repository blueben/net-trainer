const path = require('path');
const http = require('http');
const express = require('express');
const { WebSocketServer } = require('ws');
const { handleConnection } = require('./wsHandlers');

const PORT = process.env.PORT || 3000;
const ALLOWED_ORIGINS = new Set(
  (process.env.ALLOWED_ORIGINS || `http://localhost:${PORT}`).split(',').map((o) => o.trim())
);
const HEARTBEAT_INTERVAL_MS = 30000;

const app = express();
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'");
  next();
});
app.use(express.static(path.join(__dirname, '..', 'public')));

const server = http.createServer(app);
const wss = new WebSocketServer({
  server,
  path: '/ws',
  maxPayload: 16 * 1024,
  verifyClient: ({ origin }) => ALLOWED_ORIGINS.has(origin),
});

wss.on('error', (err) => console.error('[wss]', err));
wss.on('connection', handleConnection);

// Reaps sockets that dropped without a clean close (e.g. laptop lid shut,
// network cut) so they don't linger as phantom roster entries.
setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, HEARTBEAT_INTERVAL_MS);

server.listen(PORT, () => {
  console.log(`Radio Net Trainer listening on http://localhost:${PORT}`);
});
