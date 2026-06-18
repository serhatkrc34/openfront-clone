import { GameState, Player, ConquerPayload } from './types';
export declare const PLAYER_COLORS: number[];
export declare function createPlayer(id: string, name: string, colorIndex: number): Player;
export declare function tickGame(state: GameState): GameState;
export declare function applyConquer(state: GameState, playerId: string, payload: ConquerPayload): GameState | {
    error: string;
};
//# sourceMappingURL=game.d.ts.map