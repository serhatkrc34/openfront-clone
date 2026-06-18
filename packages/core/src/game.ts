import { GameState, Player, ConquerPayload, BuildPayload, BuildingType } from './types';
import { getAdjacentTileIds, getConquestCost, canConquer, WATER_TILE_TYPES } from './map';

export const PLAYER_COLORS = [
  0xd03050,  // deep rose
  0x2858d0,  // royal blue
  0x28a850,  // emerald
  0xd07828,  // amber
  0x7828d0,  // violet
  0x1898b8,  // sky teal
  0xb82090,  // magenta
  0xa88818,  // gold
  0x1898a0,  // seafoam
  0xc84828,  // burnt orange
];

export const BUILDING_COSTS: Record<BuildingType, number> = {
  city: 500,
  port: 300,
  sam: 800,
  silo: 1200,
};

export const BUILDING_GOLD_PER_TICK: Record<BuildingType, number> = {
  city: 3,
  port: 5,
  sam: 0,
  silo: 0,
};

export const BUILDING_CAPACITY_BONUS: Record<BuildingType, number> = {
  city: 5000,
  port: 500,
  sam: 0,
  silo: 0,
};

const GOLD_PER_WORKER_TICK = 0.15;
const VICTORY_THRESHOLD = 0.8;

export function createPlayer(id: string, name: string, colorIndex: number): Player {
  return {
    id,
    name,
    color: PLAYER_COLORS[colorIndex % PLAYER_COLORS.length],
    population: 3000,
    troops: 1500,
    workers: 1500,
    gold: 500,
    troopRatio: 0.5,
    isEliminated: false,
    tileCount: 0,
    alliances: [],
  };
}

export function tickGame(state: GameState): GameState {
  const newTiles = state.tiles;
  const newPlayers: Record<string, Player> = {};

  const tileCounts: Record<string, number> = {};
  for (const tile of newTiles) {
    if (tile.owner) {
      tileCounts[tile.owner] = (tileCounts[tile.owner] || 0) + 1;
    }
  }

  // Compute building bonuses per player
  const buildingGold: Record<string, number> = {};
  const buildingCapBonus: Record<string, number> = {};
  for (const building of Object.values(state.buildings)) {
    buildingGold[building.ownerId] = (buildingGold[building.ownerId] ?? 0) + BUILDING_GOLD_PER_TICK[building.type];
    buildingCapBonus[building.ownerId] = (buildingCapBonus[building.ownerId] ?? 0) + BUILDING_CAPACITY_BONUS[building.type];
  }

  const conquerableTiles = newTiles.filter(t => t.type !== 'ocean' && t.type !== 'lake').length;
  let newPhase = state.phase;
  let newWinnerId = state.winnerId;

  for (const playerId in state.players) {
    const player = { ...state.players[playerId] };
    if (player.isEliminated) {
      newPlayers[playerId] = player;
      continue;
    }

    const ownedTiles = tileCounts[playerId] || 0;
    player.tileCount = ownedTiles;

    if (ownedTiles === 0 && state.tick > 5) {
      player.isEliminated = true;
      newPlayers[playerId] = player;
      continue;
    }

    const capacity = ownedTiles * 2000 + 4000 + (buildingCapBonus[playerId] ?? 0);
    const baseGrowth = 8;
    const growthPerTick = (baseGrowth + Math.pow(player.troops, 0.70) / 5) * Math.max(0, 1 - player.population / capacity);
    player.population = Math.max(200, Math.floor(player.population + growthPerTick * 2));
    player.troops = Math.floor(player.population * player.troopRatio);
    player.workers = Math.floor(player.population * (1 - player.troopRatio));
    player.gold += player.workers * GOLD_PER_WORKER_TICK + (buildingGold[playerId] ?? 0);

    newPlayers[playerId] = player;

    if (conquerableTiles > 0 && ownedTiles / conquerableTiles >= VICTORY_THRESHOLD) {
      newPhase = 'ended';
      newWinnerId = playerId;
    }
  }

  return {
    ...state,
    tick: state.tick + 1,
    players: newPlayers,
    phase: newPhase,
    winnerId: newWinnerId,
  };
}

export function applyConquer(
  state: GameState,
  playerId: string,
  payload: ConquerPayload
): GameState | { error: string } {
  const player = state.players[playerId];
  if (!player || player.isEliminated) return { error: 'Player not found or eliminated' };

  const tile = state.tiles[payload.tileId];
  if (!tile) return { error: 'Tile not found' };
  if (!canConquer(tile)) return { error: 'Cannot conquer water tiles' };
  if (tile.owner === playerId) return { error: 'Already own this tile' };

  // Cannot attack allied territory
  if (tile.owner && player.alliances.includes(tile.owner)) {
    return { error: 'Cannot attack allied territory' };
  }

  const playerTileCount = state.tiles.filter(t => t.owner === playerId).length;
  if (playerTileCount > 0) {
    const adjacentIds = getAdjacentTileIds(payload.tileId, state.mapWidth, state.mapHeight);
    const ownsAdjacent = adjacentIds.some(id => state.tiles[id]?.owner === playerId);
    if (!ownsAdjacent) return { error: 'Must conquer adjacent to owned territory' };
  }

  const conquestCost = getConquestCost(tile);
  const availableTroops = Math.floor(player.troops * payload.percentage);

  if (availableTroops < conquestCost) {
    return { error: `Not enough troops. Need ${conquestCost}, have ${availableTroops}` };
  }

  const newTiles = [...state.tiles];
  newTiles[payload.tileId] = { ...tile, owner: playerId, troops: 0 };

  // Transfer building ownership if the tile had a building
  let newBuildings = state.buildings;
  if (state.buildings[payload.tileId]) {
    newBuildings = { ...state.buildings };
    delete newBuildings[payload.tileId];
  }

  const newPlayers = { ...state.players };
  const updatedPlayer = { ...player };
  updatedPlayer.troops = Math.max(0, player.troops - conquestCost);
  updatedPlayer.population = Math.max(100, player.population - conquestCost);
  newPlayers[playerId] = updatedPlayer;

  return { ...state, tiles: newTiles, players: newPlayers, buildings: newBuildings };
}

export function applyBuild(
  state: GameState,
  playerId: string,
  payload: BuildPayload,
): GameState | { error: string } {
  const player = state.players[playerId];
  if (!player || player.isEliminated) return { error: 'Player not found or eliminated' };

  const tile = state.tiles[payload.tileId];
  if (!tile) return { error: 'Tile not found' };
  if (tile.owner !== playerId) return { error: 'You must own this tile to build' };
  if (!canConquer(tile)) return { error: 'Cannot build on water tiles' };
  if (state.buildings[payload.tileId]) return { error: 'A building already exists here' };

  const cost = BUILDING_COSTS[payload.buildingType];
  if (player.gold < cost) {
    return { error: `Yeterli altın yok. Gerekli: ${cost}, Mevcut: ${Math.floor(player.gold)}` };
  }

  // Port must be coastal (adjacent to ocean or lake)
  if (payload.buildingType === 'port') {
    const adjIds = getAdjacentTileIds(payload.tileId, state.mapWidth, state.mapHeight);
    const isCoastal = adjIds.some(id => {
      const adj = state.tiles[id];
      return adj && WATER_TILE_TYPES.has(adj.type);
    });
    if (!isCoastal) return { error: 'Liman sadece kıyı topraklarına inşa edilebilir' };
  }

  const newBuildings = {
    ...state.buildings,
    [payload.tileId]: { tileId: payload.tileId, type: payload.buildingType, ownerId: playerId },
  };
  const newPlayers = {
    ...state.players,
    [playerId]: { ...player, gold: player.gold - cost },
  };

  return { ...state, buildings: newBuildings, players: newPlayers };
}

export function applyAlliance(
  state: GameState,
  playerA: string,
  playerB: string,
): GameState {
  const a = state.players[playerA];
  const b = state.players[playerB];
  if (!a || !b) return state;

  const newPlayers = {
    ...state.players,
    [playerA]: { ...a, alliances: [...new Set([...a.alliances, playerB])] },
    [playerB]: { ...b, alliances: [...new Set([...b.alliances, playerA])] },
  };
  return { ...state, players: newPlayers };
}

export function breakAlliance(
  state: GameState,
  playerA: string,
  playerB: string,
): GameState {
  const a = state.players[playerA];
  const b = state.players[playerB];
  if (!a || !b) return state;

  const newPlayers = {
    ...state.players,
    [playerA]: { ...a, alliances: a.alliances.filter(id => id !== playerB) },
    [playerB]: { ...b, alliances: b.alliances.filter(id => id !== playerA) },
  };
  return { ...state, players: newPlayers };
}
