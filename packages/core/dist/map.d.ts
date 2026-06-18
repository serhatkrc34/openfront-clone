import { Tile, TileType } from './types';
export declare const WATER_TILE_TYPES: Set<TileType>;
export declare function getTileIndex(x: number, y: number, width: number): number;
export declare function getTileCoords(id: number, width: number): {
    x: number;
    y: number;
};
export declare function getAdjacentTileIds(tileId: number, mapWidth: number, mapHeight: number): number[];
export declare function getConquestCost(tile: Tile): number;
export declare function canConquer(tile: Tile): boolean;
export declare function generateMap(width: number, height: number, seed: number): Tile[];
//# sourceMappingURL=map.d.ts.map