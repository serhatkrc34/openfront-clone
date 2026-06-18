import { GameState, Player, ConquerPayload, BuildPayload, BuildingType } from './types';
export declare const PLAYER_COLORS: number[];
export declare const BUILDING_COSTS: Record<BuildingType, number>;
export declare const BUILDING_GOLD_PER_TICK: Record<BuildingType, number>;
export declare const BUILDING_CAPACITY_BONUS: Record<BuildingType, number>;
export declare function createPlayer(id: string, name: string, colorIndex: number): Player;
export declare function tickGame(state: GameState): GameState;
export declare function applyConquer(state: GameState, playerId: string, payload: ConquerPayload): GameState | {
    error: string;
};
export declare function applyBuild(state: GameState, playerId: string, payload: BuildPayload): GameState | {
    error: string;
};
export declare function applyAlliance(state: GameState, playerA: string, playerB: string): GameState;
export declare function breakAlliance(state: GameState, playerA: string, playerB: string): GameState;
//# sourceMappingURL=game.d.ts.map