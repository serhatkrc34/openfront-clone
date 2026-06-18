import { GameState, GameMessage, ConquerPayload, BuildPayload, BuildingType } from '@openfront/core';

type StateCallback = (state: GameState) => void;
type TickCallback = (tick: number, players: GameState['players']) => void;
type ErrorCallback = (msg: string) => void;
type ConnectedCallback = (playerId: string, state: GameState) => void;
type DisconnectedCallback = () => void;
type AllianceProposalCallback = (fromPlayerId: string, fromName: string, fromColor: number) => void;

export class GameClient {
  private ws: WebSocket | null = null;
  private playerId: string | null = null;
  private state: GameState | null = null;

  private onStateUpdate: StateCallback | null = null;
  private onTick: TickCallback | null = null;
  private onError: ErrorCallback | null = null;
  private onConnected: ConnectedCallback | null = null;
  private onDisconnected: DisconnectedCallback | null = null;
  private onAllianceProposalCb: AllianceProposalCallback | null = null;

  connect(url: string): void {
    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      console.log('[GameClient] Connected to server');
    };

    this.ws.onmessage = (event: MessageEvent) => {
      try {
        const msg: GameMessage = JSON.parse(event.data as string);
        this.handleMessage(msg);
      } catch {
        console.warn('[GameClient] Failed to parse message');
      }
    };

    this.ws.onclose = () => {
      console.log('[GameClient] Disconnected');
      this.onDisconnected?.();
    };

    this.ws.onerror = (e) => {
      console.error('[GameClient] WebSocket error', e);
    };
  }

  private handleMessage(msg: GameMessage): void {
    switch (msg.type) {
      case 'PLAYER_JOIN': {
        const payload = msg.payload as { playerId: string; state: GameState };
        this.playerId = payload.playerId;
        this.state = payload.state;
        this.onConnected?.(this.playerId, this.state);
        break;
      }
      case 'GAME_STATE': {
        this.state = msg.payload as GameState;
        this.onStateUpdate?.(this.state);
        break;
      }
      case 'TICK': {
        const payload = msg.payload as { tick: number; players: GameState['players'] };
        if (this.state) {
          this.state = { ...this.state, tick: payload.tick, players: payload.players };
          this.onTick?.(payload.tick, payload.players);
        }
        break;
      }
      case 'PLAYER_LEAVE': {
        break;
      }
      case 'ERROR': {
        const payload = msg.payload as { message: string };
        this.onError?.(payload.message);
        break;
      }
      case 'ALLIANCE_PROPOSAL': {
        const payload = msg.payload as { fromPlayerId: string; fromName: string; fromColor: number };
        this.onAllianceProposalCb?.(payload.fromPlayerId, payload.fromName, payload.fromColor);
        break;
      }
    }
  }

  sendConquer(tileId: number, percentage: number): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const msg: GameMessage = {
      type: 'CONQUER',
      payload: { tileId, percentage } as ConquerPayload,
    };
    this.ws.send(JSON.stringify(msg));
  }

  sendSetName(name: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ type: 'SET_NAME', payload: { name } }));
  }

  sendBuild(tileId: number, buildingType: BuildingType): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const payload: BuildPayload = { tileId, buildingType };
    this.ws.send(JSON.stringify({ type: 'BUILD', payload }));
  }

  sendProposeAlliance(targetPlayerId: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ type: 'PROPOSE_ALLIANCE', payload: { targetPlayerId } }));
  }

  sendAllianceResponse(fromPlayerId: string, accept: boolean): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ type: 'ALLIANCE_RESPONSE', payload: { fromPlayerId, accept } }));
  }

  getState(): GameState | null { return this.state; }
  getPlayerId(): string | null { return this.playerId; }

  onState(cb: StateCallback): void { this.onStateUpdate = cb; }
  onTickUpdate(cb: TickCallback): void { this.onTick = cb; }
  onServerError(cb: ErrorCallback): void { this.onError = cb; }
  onConnect(cb: ConnectedCallback): void { this.onConnected = cb; }
  onDisconnect(cb: DisconnectedCallback): void { this.onDisconnected = cb; }
  onAllianceProposal(cb: AllianceProposalCallback): void { this.onAllianceProposalCb = cb; }
}
