export type TileType = 'plains' | 'mountain' | 'highland' | 'ocean' | 'lake';
export type OwnerId = string | null;
export type BuildingType = 'city' | 'port' | 'sam' | 'silo' | 'factory';

export interface Tile {
  id: number;
  x: number;
  y: number;
  type: TileType;
  elevation: number; // 0-100
  owner: OwnerId;
  troops: number;
}

export interface Building {
  tileId: number;
  type: BuildingType;
  ownerId: string;
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
  alliances: string[]; // player IDs allied with
}

export interface GameState {
  tick: number;
  mapWidth: number;
  mapHeight: number;
  tiles: Tile[];
  players: Record<string, Player>;
  phase: 'lobby' | 'playing' | 'ended';
  winnerId: OwnerId;
  buildings: Record<number, Building>; // keyed by tile ID
}

export type MessageType =
  | 'GAME_STATE'
  | 'PLAYER_JOIN'
  | 'PLAYER_LEAVE'
  | 'CONQUER'
  | 'TICK'
  | 'ERROR'
  | 'SET_NAME'
  | 'BUILD'
  | 'PROPOSE_ALLIANCE'
  | 'ALLIANCE_PROPOSAL'
  | 'ALLIANCE_RESPONSE'
  | 'NUKE'
  | 'NUKE_EVENT';

export interface GameMessage {
  type: MessageType;
  payload: unknown;
}

export interface ConquerPayload {
  tileId: number;
  percentage: number; // 0.1 to 1.0
}

export interface BuildPayload {
  tileId: number;
  buildingType: BuildingType;
}

export interface ProposeAlliancePayload {
  targetPlayerId: string;
}

export interface AllianceResponsePayload {
  fromPlayerId: string;
  accept: boolean;
}

export interface NukePayload {
  siloTileId: number;
  targetTileId: number;
}

export type NukeResult =
  | { success: false; error: string }
  | { success: true; intercepted: false; state: GameState }
  | { success: true; intercepted: true; state: GameState; interceptedAt: number };
