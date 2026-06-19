"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BUILDING_GROWTH_MULT = exports.BUILDING_CAPACITY_BONUS = exports.BUILDING_GOLD_PER_TICK = exports.BUILDING_COSTS = exports.PLAYER_COLORS = void 0;
exports.createPlayer = createPlayer;
exports.tickGame = tickGame;
exports.applyConquer = applyConquer;
exports.applyBuild = applyBuild;
exports.applyAlliance = applyAlliance;
exports.breakAlliance = breakAlliance;
exports.applyNuke = applyNuke;
const map_1 = require("./map");
exports.PLAYER_COLORS = [
    0xd03050, // deep rose
    0x2858d0, // royal blue
    0x28a850, // emerald
    0xd07828, // amber
    0x7828d0, // violet
    0x1898b8, // sky teal
    0xb82090, // magenta
    0xa88818, // gold
    0x1898a0, // seafoam
    0xc84828, // burnt orange
];
exports.BUILDING_COSTS = {
    city: 500,
    port: 300,
    sam: 800,
    silo: 1200,
    factory: 800,
};
exports.BUILDING_GOLD_PER_TICK = {
    city: 3,
    port: 5,
    sam: 0,
    silo: 0,
    factory: 0,
};
exports.BUILDING_CAPACITY_BONUS = {
    city: 5000,
    port: 500,
    sam: 0,
    silo: 0,
    factory: 0,
};
exports.BUILDING_GROWTH_MULT = {
    city: 1,
    port: 1,
    sam: 1,
    silo: 1,
    factory: 1.4,
};
const GOLD_PER_WORKER_TICK = 0.15;
const VICTORY_THRESHOLD = 0.8;
function createPlayer(id, name, colorIndex) {
    return {
        id,
        name,
        color: exports.PLAYER_COLORS[colorIndex % exports.PLAYER_COLORS.length],
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
function tickGame(state) {
    const newTiles = state.tiles;
    const newPlayers = {};
    const tileCounts = {};
    for (const tile of newTiles) {
        if (tile.owner) {
            tileCounts[tile.owner] = (tileCounts[tile.owner] || 0) + 1;
        }
    }
    // Compute building bonuses per player
    const buildingGold = {};
    const buildingCapBonus = {};
    const factMult = {};
    for (const building of Object.values(state.buildings)) {
        buildingGold[building.ownerId] = (buildingGold[building.ownerId] ?? 0) + exports.BUILDING_GOLD_PER_TICK[building.type];
        buildingCapBonus[building.ownerId] = (buildingCapBonus[building.ownerId] ?? 0) + exports.BUILDING_CAPACITY_BONUS[building.type];
        if (building.type === 'factory') {
            factMult[building.ownerId] = (factMult[building.ownerId] ?? 1) * exports.BUILDING_GROWTH_MULT.factory;
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
        const capacity = ownedTiles * 2000 + 4000 + (buildingCapBonus[playerId] ?? 0);
        const baseGrowth = 8;
        const mult = factMult[playerId] ?? 1;
        const growthPerTick = (baseGrowth + Math.pow(player.troops, 0.70) / 5) * Math.max(0, 1 - player.population / capacity) * mult;
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
    // Cannot attack allied territory
    if (tile.owner && player.alliances.includes(tile.owner)) {
        return { error: 'Cannot attack allied territory' };
    }
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
function applyBuild(state, playerId, payload) {
    const player = state.players[playerId];
    if (!player || player.isEliminated)
        return { error: 'Player not found or eliminated' };
    const tile = state.tiles[payload.tileId];
    if (!tile)
        return { error: 'Tile not found' };
    if (tile.owner !== playerId)
        return { error: 'You must own this tile to build' };
    if (!(0, map_1.canConquer)(tile))
        return { error: 'Cannot build on water tiles' };
    if (state.buildings[payload.tileId])
        return { error: 'A building already exists here' };
    const cost = exports.BUILDING_COSTS[payload.buildingType];
    if (player.gold < cost) {
        return { error: `Yeterli altın yok. Gerekli: ${cost}, Mevcut: ${Math.floor(player.gold)}` };
    }
    // Port must be coastal (adjacent to ocean or lake)
    if (payload.buildingType === 'port') {
        const adjIds = (0, map_1.getAdjacentTileIds)(payload.tileId, state.mapWidth, state.mapHeight);
        const isCoastal = adjIds.some(id => {
            const adj = state.tiles[id];
            return adj && map_1.WATER_TILE_TYPES.has(adj.type);
        });
        if (!isCoastal)
            return { error: 'Liman sadece kıyı topraklarına inşa edilebilir' };
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
function applyAlliance(state, playerA, playerB) {
    const a = state.players[playerA];
    const b = state.players[playerB];
    if (!a || !b)
        return state;
    const newPlayers = {
        ...state.players,
        [playerA]: { ...a, alliances: [...new Set([...a.alliances, playerB])] },
        [playerB]: { ...b, alliances: [...new Set([...b.alliances, playerA])] },
    };
    return { ...state, players: newPlayers };
}
function breakAlliance(state, playerA, playerB) {
    const a = state.players[playerA];
    const b = state.players[playerB];
    if (!a || !b)
        return state;
    const newPlayers = {
        ...state.players,
        [playerA]: { ...a, alliances: a.alliances.filter(id => id !== playerB) },
        [playerB]: { ...b, alliances: b.alliances.filter(id => id !== playerA) },
    };
    return { ...state, players: newPlayers };
}
function applyNuke(state, playerId, payload) {
    const player = state.players[playerId];
    if (!player || player.isEliminated)
        return { success: false, error: 'Oyuncu bulunamadı' };
    const silo = state.buildings[payload.siloTileId];
    if (!silo || silo.type !== 'silo' || silo.ownerId !== playerId)
        return { success: false, error: 'Bu konumda silo yok' };
    const targetTile = state.tiles[payload.targetTileId];
    if (!targetTile)
        return { success: false, error: 'Geçersiz hedef' };
    // Check SAM interception (any SAM within 15 tiles of target)
    const SAM_RADIUS = 15;
    for (const b of Object.values(state.buildings)) {
        if (b.type !== 'sam')
            continue;
        const samTile = state.tiles[b.tileId];
        if (!samTile)
            continue;
        const dx = samTile.x - targetTile.x, dy = samTile.y - targetTile.y;
        if (Math.sqrt(dx * dx + dy * dy) <= SAM_RADIUS) {
            const nb = { ...state.buildings };
            delete nb[b.tileId];
            const ns = { ...nb };
            delete ns[payload.siloTileId];
            return { success: true, intercepted: true, interceptedAt: b.tileId, state: { ...state, buildings: { ...ns } } };
        }
    }
    // Nuke hits — clear tiles in radius 8
    const RADIUS = 8;
    const newTiles = [...state.tiles];
    const newPlayers = { ...state.players };
    for (const tile of state.tiles) {
        const dx = tile.x - targetTile.x, dy = tile.y - targetTile.y;
        if (Math.sqrt(dx * dx + dy * dy) <= RADIUS && tile.owner) {
            const owner = newPlayers[tile.owner];
            if (owner)
                newPlayers[tile.owner] = { ...owner, population: Math.max(100, Math.floor(owner.population * 0.65)), troops: Math.max(50, Math.floor(owner.troops * 0.65)), workers: Math.max(50, Math.floor(owner.workers * 0.65)) };
            newTiles[tile.id] = { ...tile, owner: null, troops: 0 };
        }
    }
    const newBuildings = { ...state.buildings };
    delete newBuildings[payload.siloTileId];
    // Also destroy any buildings in blast radius
    for (const b of Object.values(state.buildings)) {
        const bt = state.tiles[b.tileId];
        if (bt) {
            const dx = bt.x - targetTile.x, dy = bt.y - targetTile.y;
            if (Math.sqrt(dx * dx + dy * dy) <= RADIUS)
                delete newBuildings[b.tileId];
        }
    }
    return { success: true, intercepted: false, state: { ...state, tiles: newTiles, players: newPlayers, buildings: newBuildings } };
}
//# sourceMappingURL=game.js.map