import { WebSocket } from 'ws';
import {
  GameState,
  GameMessage,
  ConquerPayload,
  BuildPayload,
  ProposeAlliancePayload,
  AllianceResponsePayload,
  generateMap,
  tickGame,
  applyConquer,
  applyBuild,
  applyAlliance,
  createPlayer,
} from '@openfront/core';
import { computeBotAction, addBot } from './botAI';

const TICK_MS = 100;
const BOT_TICK_INTERVAL = 3;
const BOT_COUNT = 20;

interface PendingAlliance {
  fromId: string;
  toId: string;
  expiresAtTick: number;
}

export class GameRoom {
  private id: string;
  private state: GameState;
  private clients: Map<string, WebSocket> = new Map();
  private tickInterval: ReturnType<typeof setInterval> | null = null;
  private playerCount = 0;
  private botIds: string[] = [];
  private pendingAlliances: PendingAlliance[] = [];

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
      buildings: {},
    };
  }

  start(): void {
    this.initBots();
    this.state = { ...this.state, phase: 'playing' };
    this.tickInterval = setInterval(() => this.tick(), TICK_MS);
    console.log(`[Room ${this.id}] Game started — ${BOT_COUNT} bots added`);
  }

  private initBots(): void {
    const botNames = [
      'Alpha','Beta','Gamma','Delta','Epsilon',
      'Zeta','Eta','Theta','Iota','Kappa',
      'Lambda','Mu','Nu','Xi','Omicron',
      'Pi','Rho','Sigma','Tau','Upsilon',
    ];
    for (let i = 0; i < BOT_COUNT; i++) {
      const botId = `bot_${i}`;
      this.state = addBot(this.state, botId, botNames[i] ?? `Bot${i}`, i + 1);
      this.botIds.push(botId);
    }
  }

  private tickBots(): void {
    for (const botId of this.botIds) {
      const action = computeBotAction(this.state, botId);
      if (!action) continue;
      const result = applyConquer(this.state, botId, action);
      if (!('error' in result)) {
        this.state = result;
      }
    }
  }

  addPlayer(ws: WebSocket): void {
    const playerId = `p_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const player = createPlayer(playerId, `Player ${this.playerCount + 1}`, BOT_COUNT + this.playerCount);
    this.playerCount++;

    this.state = {
      ...this.state,
      players: { ...this.state.players, [playerId]: player },
    };

    this.clients.set(playerId, ws);

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

    console.log(`[Room ${this.id}] Human player joined: ${playerId}`);
    this.sendToClient(ws, { type: 'PLAYER_JOIN', payload: { playerId, state: this.state } });
    this.broadcastExcept(playerId, { type: 'GAME_STATE', payload: this.state });

    ws.on('message', (data: Buffer) => {
      try {
        const msg: GameMessage = JSON.parse(data.toString());
        this.handleMessage(playerId, msg);
      } catch {
        // ignore malformed
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
    if (msg.type === 'SET_NAME') {
      const name = String((msg.payload as { name: string }).name ?? '').trim().slice(0, 20);
      if (name && this.state.players[playerId]) {
        const players = { ...this.state.players };
        players[playerId] = { ...players[playerId], name };
        this.state = { ...this.state, players };
        this.broadcast({ type: 'GAME_STATE', payload: this.state });
      }
      return;
    }

    if (msg.type === 'PROPOSE_ALLIANCE') {
      const payload = msg.payload as ProposeAlliancePayload;
      const targetId = payload.targetPlayerId;
      const target = this.state.players[targetId];
      const self = this.state.players[playerId];

      if (!target || !self || target.isEliminated) {
        const ws = this.clients.get(playerId);
        if (ws) this.sendToClient(ws, { type: 'ERROR', payload: { message: 'Geçersiz hedef oyuncu' } });
        return;
      }

      // Bots auto-reject alliances
      if (this.botIds.includes(targetId)) {
        const ws = this.clients.get(playerId);
        if (ws) this.sendToClient(ws, { type: 'ERROR', payload: { message: `${target.name} ittifak teklifini reddetti` } });
        return;
      }

      // Already allied
      if (self.alliances.includes(targetId)) {
        const ws = this.clients.get(playerId);
        if (ws) this.sendToClient(ws, { type: 'ERROR', payload: { message: 'Zaten ittifak kuruldı' } });
        return;
      }

      // Remove any old pending proposal between these two
      this.pendingAlliances = this.pendingAlliances.filter(
        p => !(p.fromId === playerId && p.toId === targetId)
      );

      this.pendingAlliances.push({
        fromId: playerId,
        toId: targetId,
        expiresAtTick: this.state.tick + 300, // 30 seconds
      });

      const targetWs = this.clients.get(targetId);
      if (targetWs) {
        this.sendToClient(targetWs, {
          type: 'ALLIANCE_PROPOSAL',
          payload: { fromPlayerId: playerId, fromName: self.name, fromColor: self.color },
        });
      }
      return;
    }

    if (msg.type === 'ALLIANCE_RESPONSE') {
      const payload = msg.payload as AllianceResponsePayload;
      const fromId = payload.fromPlayerId;

      const pendingIdx = this.pendingAlliances.findIndex(
        p => p.fromId === fromId && p.toId === playerId
      );

      if (pendingIdx === -1) {
        const ws = this.clients.get(playerId);
        if (ws) this.sendToClient(ws, { type: 'ERROR', payload: { message: 'Aktif ittifak teklifi bulunamadı' } });
        return;
      }

      this.pendingAlliances.splice(pendingIdx, 1);

      if (payload.accept) {
        this.state = applyAlliance(this.state, fromId, playerId);
        this.broadcast({ type: 'GAME_STATE', payload: this.state });
      } else {
        const fromWs = this.clients.get(fromId);
        const declinerName = this.state.players[playerId]?.name ?? 'Oyuncu';
        if (fromWs) {
          this.sendToClient(fromWs, {
            type: 'ERROR',
            payload: { message: `${declinerName} ittifak teklifini reddetti` },
          });
        }
      }
      return;
    }

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

    if (msg.type === 'BUILD') {
      const payload = msg.payload as BuildPayload;
      const result = applyBuild(this.state, playerId, payload);
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

    if (this.state.tick % BOT_TICK_INTERVAL === 0) {
      this.tickBots();
    }

    this.state = tickGame(this.state);

    // Expire old alliance proposals
    if (this.pendingAlliances.length > 0) {
      const expired = this.pendingAlliances.filter(p => p.expiresAtTick <= this.state.tick);
      this.pendingAlliances = this.pendingAlliances.filter(p => p.expiresAtTick > this.state.tick);
      for (const p of expired) {
        const fromWs = this.clients.get(p.fromId);
        const toName = this.state.players[p.toId]?.name ?? 'Oyuncu';
        if (fromWs) {
          this.sendToClient(fromWs, {
            type: 'ERROR',
            payload: { message: `${toName} ittifak teklifine yanıt vermedi` },
          });
        }
      }
    }

    if (this.state.tick % 10 === 0) {
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
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
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
