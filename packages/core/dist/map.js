"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WATER_TILE_TYPES = void 0;
exports.getTileIndex = getTileIndex;
exports.getTileCoords = getTileCoords;
exports.getAdjacentTileIds = getAdjacentTileIds;
exports.getConquestCost = getConquestCost;
exports.canConquer = canConquer;
exports.generateMap = generateMap;
exports.WATER_TILE_TYPES = new Set(['ocean', 'lake']);
const TERRAIN_COST = {
    plains: 1.0,
    highland: 1.5,
    mountain: 2.5,
    ocean: Infinity,
    lake: Infinity,
};
function getTileIndex(x, y, width) {
    return y * width + x;
}
function getTileCoords(id, width) {
    return { x: id % width, y: Math.floor(id / width) };
}
function getAdjacentTileIds(tileId, mapWidth, mapHeight) {
    const { x, y } = getTileCoords(tileId, mapWidth);
    const adjacent = [];
    if (x > 0)
        adjacent.push(getTileIndex(x - 1, y, mapWidth));
    if (x < mapWidth - 1)
        adjacent.push(getTileIndex(x + 1, y, mapWidth));
    if (y > 0)
        adjacent.push(getTileIndex(x, y - 1, mapWidth));
    if (y < mapHeight - 1)
        adjacent.push(getTileIndex(x, y + 1, mapWidth));
    return adjacent;
}
function getConquestCost(tile) {
    const baseCost = TERRAIN_COST[tile.type];
    if (!isFinite(baseCost))
        return Infinity;
    const elevationMultiplier = 1 + (tile.elevation / 100) * 1.0;
    return Math.floor(baseCost * elevationMultiplier * 20);
}
function canConquer(tile) {
    return tile.type !== 'ocean' && tile.type !== 'lake';
}
function generateMap(width, height, seed) {
    const tiles = [];
    let s = seed;
    function rand() {
        s = (s * 1664525 + 1013904223) & 0xffffffff;
        return (s >>> 0) / 0xffffffff;
    }
    const elevations = new Array(width * height);
    for (let i = 0; i < width * height; i++) {
        elevations[i] = rand() * 100;
    }
    // Simple box blur to smooth elevation
    for (let pass = 0; pass < 4; pass++) {
        const smoothed = [...elevations];
        for (let y2 = 1; y2 < height - 1; y2++) {
            for (let x2 = 1; x2 < width - 1; x2++) {
                const idx = y2 * width + x2;
                smoothed[idx] = (elevations[idx] +
                    elevations[idx - 1] +
                    elevations[idx + 1] +
                    elevations[idx - width] +
                    elevations[idx + width]) / 5;
            }
        }
        for (let i = 0; i < width * height; i++)
            elevations[i] = smoothed[i];
    }
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const idx = y * width + x;
            const elev = elevations[idx];
            let type;
            const isEdge = x === 0 || y === 0 || x === width - 1 || y === height - 1;
            if (isEdge || elev < 22) {
                type = 'ocean';
            }
            else if (elev < 33) {
                type = 'lake';
            }
            else if (elev < 58) {
                type = 'plains';
            }
            else if (elev < 76) {
                type = 'highland';
            }
            else {
                type = 'mountain';
            }
            tiles.push({
                id: idx,
                x,
                y,
                type,
                elevation: Math.floor(elev),
                owner: null,
                troops: type === 'ocean' || type === 'lake' ? 0 : Math.floor(elev * 0.5 + 50),
            });
        }
    }
    return tiles;
}
//# sourceMappingURL=map.js.map