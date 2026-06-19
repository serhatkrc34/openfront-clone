import {
  GameState,
  applyConquer,
  getAdjacentTileIds,
  canConquer,
  getConquestCost,
  createPlayer,
  generateMap,
} from '@openfront/core';

export interface BotAction {
  tileId: number;
  percentage: number;
}

// Finds the best tile for a bot to conquer next
export function computeBotAction(state: GameState, botId: string): BotAction | null {
  const bot = state.players[botId];
  if (!bot || bot.isEliminated || bot.tileCount === 0) return null;

  const { tiles, mapWidth, mapHeight } = state;

  // Collect all border tiles (adjacent to bot's territory, conquerable, not owned by bot)
  const candidates: Array<{ tileId: number; cost: number }> = [];

  for (const tile of tiles) {
    if (tile.owner !== botId) continue;
    for (const adjId of getAdjacentTileIds(tile.id, mapWidth, mapHeight)) {
      const adj = tiles[adjId];
      if (!adj || !canConquer(adj) || adj.owner === botId) continue;
      const cost = getConquestCost(adj);
      if (isFinite(cost)) candidates.push({ tileId: adjId, cost });
    }
  }

  if (candidates.length === 0) return null;

  // Prefer cheap tiles, with some randomness
  candidates.sort((a, b) => a.cost - b.cost);
  const topN = Math.min(5, candidates.length);
  const pick = candidates[Math.floor(Math.random() * topN)];

  // Calculate needed percentage
  const needed = pick.cost;
  const pct = Math.min(1.0, (needed / Math.max(1, bot.troops)) * 1.1 + 0.1);

  return { tileId: pick.tileId, percentage: Math.max(0.1, Math.min(1.0, pct)) };
}

export function addBot(
  state: GameState,
  botId: string,
  name: string,
  colorIndex: number
): GameState {
  const player = createPlayer(botId, name, colorIndex, true);

  const newState: GameState = {
    ...state,
    players: { ...state.players, [botId]: player },
  };

  // Assign random starting tile
  const landTiles = newState.tiles.filter(
    t => t.type !== 'ocean' && t.type !== 'lake' && t.owner === null
  );
  if (landTiles.length === 0) return newState;

  const idx = Math.floor(Math.random() * landTiles.length);
  const startTile = landTiles[idx];
  const newTiles = [...newState.tiles];
  newTiles[startTile.id] = { ...startTile, owner: botId };

  return { ...newState, tiles: newTiles };
}
