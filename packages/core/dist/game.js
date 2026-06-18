"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PLAYER_COLORS = void 0;
exports.createPlayer = createPlayer;
exports.tickGame = tickGame;
exports.applyConquer = applyConquer;
const map_1 = require("./map");
exports.PLAYER_COLORS = [
    0xe74c3c,
    0x3498db,
    0x2ecc71,
    0xf39c12,
    0x9b59b6,
    0x1abc9c,
    0xe91e63,
    0xffeb3b,
];
const POPULATION_GROWTH_RATE = 0.0015;
const GOLD_PER_WORKER_TICK = 0.08;
const VICTORY_THRESHOLD = 0.8;
function createPlayer(id, name, colorIndex) {
    return {
        id,
        name,
        color: exports.PLAYER_COLORS[colorIndex % exports.PLAYER_COLORS.length],
        population: 1000,
        troops: 500,
        workers: 500,
        gold: 500,
        troopRatio: 0.5,
        isEliminated: false,
        tileCount: 0,
    };
}
function tickGame(state) {
    const newTiles = state.tiles;
    const newPlayers = {};
    const tileCounts = {};
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
        // Logistic population growth
        const capacity = ownedTiles * 250 + 500;
        const growthFactor = POPULATION_GROWTH_RATE * (1 - player.population / capacity);
        player.population = Math.max(100, player.population + player.population * growthFactor);
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
function applyConquer(state, playerId, payload) {
    const player = state.players[playerId];
    if (!player || player.isEliminated)
        return { error: 'Player not found or eliminated' };
    const tile = state.tiles[payload.tileId];
    if (!tile)
        return { error: 'Tile not found' };
    if (!(0, map_1.canConquer)(tile))
        return { error: 'Cannot conquer water tiles' };
    if (tile.owner === playerId)
        return { error: 'Already own this tile' };
    const playerTileCount = state.tiles.filter(t => t.owner === playerId).length;
    if (playerTileCount > 0) {
        const adjacentIds = (0, map_1.getAdjacentTileIds)(payload.tileId, state.mapWidth, state.mapHeight);
        const ownsAdjacent = adjacentIds.some(id => state.tiles[id]?.owner === playerId);
        if (!ownsAdjacent)
            return { error: 'Must conquer adjacent to owned territory' };
    }
    const conquestCost = (0, map_1.getConquestCost)(tile);
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
//# sourceMappingURL=game.js.map