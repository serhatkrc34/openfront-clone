import { GameState, Player, ConquerPayload, BuildPayload, BuildingType, NukePayload, NukeResult } from './types';
export declare const PLAYER_COLORS: number[];
export declare const BUILDING_COSTS: Record<BuildingType, number>;
export declare const BUILDING_GOLD_PER_TICK: Record<BuildingType, number>;
export declare const BUILDING_MAX_TROOP_BONUS: Record<BuildingType, number>;
export declare const BUILDING_GROWTH_MULT: Record<BuildingType, number>;
export declare const DEFENSE_POST_MULT = 5;
export declare function createPlayer(id: string, name: string, colorIndex: number, isBot?: boolean): Player;
export declare function tickGame(state: GameState): GameState;
export declare function applyConquer(state: GameState, playerId: string, payload: ConquerPayload): GameState | {
    error: string;
};
export declare function applyBuild(state: GameState, playerId: string, payload: BuildPayload): GameState | {
    error: string;
};
export declare function applyAlliance(state: GameState, playerA: string, playerB: string): GameState;
export declare function breakAlliance(state: GameState, playerA: string, playerB: string): GameState;
export declare function applyNuke(state: GameState, playerId: string, payload: NukePayload): NukeResult;
//# sourceMappingURL=game.d.ts.map