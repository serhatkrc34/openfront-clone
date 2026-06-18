export type TileType = 'plains' | 'mountain' | 'highland' | 'ocean' | 'lake';
export type OwnerId = string | null;

export interface Tile {
  id: number;
  x: number;
  y: number;
  type: TileType;
  elevation: number; // 0-100
  owner: OwnerId;
  troops: number;
}

export interface Player {
  id: string;
  name: string;
  color: number; // hex color as 0xRRGGBB number
  population: number;
  troops: number;
  workers: number;
  gold: number;
  troopRatio: number; // 0-1
  isEliminated: boolean;
  tileCount: number;
}

export interface GameState {
  tick: number;
  mapWidth: number;
  mapHeight: number;
  tiles: Tile[];
  players: Record<string, Player>;
  phase: 'lobby' | 'playing' | 'ended';
  winnerId: OwnerId;
}

export type MessageType =
  | 'GAME_STATE'
  | 'PLAYER_JOIN'
  | 'PLAYER_LEAVE'
  | 'CONQUER'
  | 'TICK'
  | 'ERROR';

export interface GameMessage {
  type: MessageType;
  payload: unknown;
}

export interface ConquerPayload {
  tileId: number;
  percentage: number; // 0.1 to 1.0
}
