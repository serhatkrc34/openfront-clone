import { GameState, Player, ConquerPayload } from './types';
import { getAdjacentTileIds, getConquestCost, canConquer } from './map';

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

    // Real Openfront-style growth: power-law formula with soft cap
    // toAdd = (baseGrowth + troops^0.70 / 5) * (1 - troops / capacity)
    const capacity = ownedTiles * 2000 + 4000;
    const baseGrowth = 8;
    const growthPerTick = (baseGrowth + Math.pow(player.troops, 0.70) / 5) * Math.max(0, 1 - player.population / capacity);
    player.population = Math.max(200, Math.floor(player.population + growthPerTick * 2));
    player.troops = Math.floor(player.population * player.troopRatio);
    player.workers = Math.floor(player.population * (1 - player.troopRatio));
    player.gold += player.workers * GOLD_PER_WORKER_TICK;

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

  const newPlayers = { ...state.players };
  const updatedPlayer = { ...player };
  updatedPlayer.troops = Math.max(0, player.troops - conquestCost);
  updatedPlayer.population = Math.max(100, player.population - conquestCost);
  newPlayers[playerId] = updatedPlayer;

  return { ...state, tiles: newTiles, players: newPlayers };
}
