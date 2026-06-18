import { Tile, TileType } from './types';

const TERRAIN_COST: Record<TileType, number> = {
  plains: 1.0,
  highland: 1.5,
  mountain: 2.5,
  ocean: Infinity,
  lake: Infinity,
};

export function getTileIndex(x: number, y: number, width: number): number {
  return y * width + x;
}

export function getTileCoords(id: number, width: number): { x: number; y: number } {
  return { x: id % width, y: Math.floor(id / width) };
}

export function getAdjacentTileIds(tileId: number, mapWidth: number, mapHeight: number): number[] {
  const { x, y } = getTileCoords(tileId, mapWidth);
  const adjacent: number[] = [];
  if (x > 0) adjacent.push(getTileIndex(x - 1, y, mapWidth));
  if (x < mapWidth - 1) adjacent.push(getTileIndex(x + 1, y, mapWidth));
  if (y > 0) adjacent.push(getTileIndex(x, y - 1, mapWidth));
  if (y < mapHeight - 1) adjacent.push(getTileIndex(x, y + 1, mapWidth));
  return adjacent;
}

export function getConquestCost(tile: Tile): number {
  const baseCost = TERRAIN_COST[tile.type];
  if (!isFinite(baseCost)) return Infinity;
  const elevationMultiplier = 1 + (tile.elevation / 100) * 1.5;
  return Math.floor(baseCost * elevationMultiplier * 100);
}

export function canConquer(tile: Tile): boolean {
  return tile.type !== 'ocean' && tile.type !== 'lake';
}

export function generateMap(width: number, height: number, seed: number): Tile[] {
  const tiles: Tile[] = [];
  let s = seed;

  function rand(): number {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  }

  const elevations: number[] = new Array(width * height);
  for (let i = 0; i < width * height; i++) {
    elevations[i] = rand() * 100;
  }

  // Simple box blur to smooth elevation
  for (let pass = 0; pass < 4; pass++) {
    const smoothed = [...elevations];
    for (let y2 = 1; y2 < height - 1; y2++) {
      for (let x2 = 1; x2 < width - 1; x2++) {
        const idx = y2 * width + x2;
        smoothed[idx] = (
          elevations[idx] +
          elevations[idx - 1] +
          elevations[idx + 1] +
          elevations[idx - width] +
          elevations[idx + width]
        ) / 5;
      }
    }
    for (let i = 0; i < width * height; i++) elevations[i] = smoothed[i];
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const elev = elevations[idx];
      let type: TileType;

      const isEdge = x === 0 || y === 0 || x === width - 1 || y === height - 1;
      if (isEdge || elev < 22) {
        type = 'ocean';
      } else if (elev < 33) {
        type = 'lake';
      } else if (elev < 58) {
        type = 'plains';
      } else if (elev < 76) {
        type = 'highland';
      } else {
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
