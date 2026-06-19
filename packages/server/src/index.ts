import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { GameRoom } from './gameRoom';

const app = express();
const PORT = Number(process.env.PORT) || 3001;

app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer });

const defaultRoom = new GameRoom('default', 512, 300);
defaultRoom.start();

wss.on('connection', (ws) => {
  defaultRoom.addPlayer(ws);
});

httpServer.listen(PORT, () => {
  console.log(`[Server] Listening on port ${PORT}`);
});
