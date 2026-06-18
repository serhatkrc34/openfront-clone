export type TileType = 'plains' | 'mountain' | 'highland' | 'ocean' | 'lake';
export type OwnerId = string | null;
export type BuildingType = 'city' | 'port' | 'sam' | 'silo';
export interface Tile {
    id: number;
    x: number;
    y: number;
    type: TileType;
    elevation: number;
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
    color: number;
    population: number;
    troops: number;
    workers: number;
    gold: number;
    troopRatio: number;
    isEliminated: boolean;
    tileCount: number;
    alliances: string[];
}
export interface GameState {
    tick: number;
    mapWidth: number;
    mapHeight: number;
    tiles: Tile[];
    players: Record<string, Player>;
    phase: 'lobby' | 'playing' | 'ended';
    winnerId: OwnerId;
    buildings: Record<number, Building>;
}
export type MessageType = 'GAME_STATE' | 'PLAYER_JOIN' | 'PLAYER_LEAVE' | 'CONQUER' | 'TICK' | 'ERROR' | 'SET_NAME' | 'BUILD' | 'PROPOSE_ALLIANCE' | 'ALLIANCE_PROPOSAL' | 'ALLIANCE_RESPONSE';
export interface GameMessage {
    type: MessageType;
    payload: unknown;
}
export interface ConquerPayload {
    tileId: number;
    percentage: number;
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
//# sourceMappingURL=types.d.ts.map