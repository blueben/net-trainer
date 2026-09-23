const path = require('path');
const http = require('http');
const express = require('express');
const { WebSocketServer } = require('ws');
const { handleConnection } = require('./wsHandlers');

const PORT = process.env.PORT || 3000;
const ALLOWED_ORIGINS = new Set(
  (process.env.ALLOWED_ORIGINS || `http://localhost:${PORT}`).split(',').map((o) => o.trim())
);

const app = express();
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

server.listen(PORT, () => {
  console.log(`Radio Net Trainer listening on http://localhost:${PORT}`);
});
