import { WebSocket } from 'ws';
import {
  GameState,
  GameMessage,
  ConquerPayload,
  generateMap,
  tickGame,
  applyConquer,
  createPlayer,
} from '@openfront/core';

const TICK_MS = 200;

export class GameRoom {
  private id: string;
  private state: GameState;
  private clients: Map<string, WebSocket> = new Map();
  private tickInterval: ReturnType<typeof setInterval> | null = null;
  private playerCount = 0;

  constructor(id: string, mapWidth: number, mapHeight: number) {
    this.id = id;
    this.state = {
      tick: 0,
      mapWidth,
      mapHeight,
      tiles: generateMap(mapWidth, mapHeight, 42),
      players: {},
      phase: 'lobby',
      winnerId: null,
    };
  }

  start(): void {
    this.state = { ...this.state, phase: 'playing' };
    this.tickInterval = setInterval(() => this.tick(), TICK_MS);
    console.log(`[Room ${this.id}] Game started with map ${this.state.mapWidth}x${this.state.mapHeight}`);
  }

  addPlayer(ws: WebSocket): void {
    const playerId = `p_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const player = createPlayer(playerId, `Player ${this.playerCount + 1}`, this.playerCount);
    this.playerCount++;

    this.state = {
      ...this.state,
      players: { ...this.state.players, [playerId]: player },
    };

    this.clients.set(playerId, ws);

    // Assign a random starting land tile
    const landTiles = this.state.tiles.filter(
      t => t.type !== 'ocean' && t.type !== 'lake' && t.owner === null
    );
    if (landTiles.length > 0) {
      const startIdx = Math.floor(Math.random() * landTiles.length);
      const startTile = landTiles[startIdx];
      const newTiles = [...this.state.tiles];
      newTiles[startTile.id] = { ...startTile, owner: playerId };
      this.state = { ...this.state, tiles: newTiles };
    }

    console.log(`[Room ${this.id}] Player joined: ${playerId}`);
    this.sendToClient(ws, { type: 'PLAYER_JOIN', payload: { playerId, state: this.state } });
    this.broadcastExcept(playerId, { type: 'GAME_STATE', payload: this.state });

    ws.on('message', (data: Buffer) => {
      try {
        const msg: GameMessage = JSON.parse(data.toString());
        this.handleMessage(playerId, msg);
      } catch {
        // ignore malformed messages
      }
    });

    ws.on('close', () => {
      this.clients.delete(playerId);
      const players = { ...this.state.players };
      if (players[playerId]) {
        players[playerId] = { ...players[playerId], isEliminated: true };
        this.state = { ...this.state, players };
      }
      console.log(`[Room ${this.id}] Player disconnected: ${playerId}`);
      this.broadcast({ type: 'PLAYER_LEAVE', payload: { playerId } });
    });
  }

  private handleMessage(playerId: string, msg: GameMessage): void {
    if (this.state.phase !== 'playing') return;

    if (msg.type === 'CONQUER') {
      const payload = msg.payload as ConquerPayload;
      const result = applyConquer(this.state, playerId, payload);
      if ('error' in result) {
        const ws = this.clients.get(playerId);
        if (ws) this.sendToClient(ws, { type: 'ERROR', payload: { message: result.error } });
      } else {
        this.state = result;
        this.broadcast({ type: 'GAME_STATE', payload: this.state });
      }
    }
  }

  private tick(): void {
    if (this.state.phase !== 'playing') return;
    this.state = tickGame(this.state);

    // On every 5th tick send full state, otherwise just player data
    if (this.state.tick % 5 === 0) {
      this.broadcast({ type: 'GAME_STATE', payload: this.state });
    } else {
      this.broadcast({ type: 'TICK', payload: { tick: this.state.tick, players: this.state.players } });
    }

    if (this.state.phase === 'ended' && this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
      console.log(`[Room ${this.id}] Game ended! Winner: ${this.state.winnerId}`);
    }
  }

  private sendToClient(ws: WebSocket, msg: GameMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }

  private broadcast(msg: GameMessage): void {
    const data = JSON.stringify(msg);
    for (const ws of this.clients.values()) {
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
    }
  }

  private broadcastExcept(excludeId: string, msg: GameMessage): void {
    const data = JSON.stringify(msg);
    for (const [id, ws] of this.clients.entries()) {
      if (id !== excludeId && ws.readyState === WebSocket.OPEN) ws.send(data);
    }
  }
}
