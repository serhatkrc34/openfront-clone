"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFENSE_POST_MULT = exports.BUILDING_GROWTH_MULT = exports.BUILDING_MAX_TROOP_BONUS = exports.BUILDING_GOLD_PER_TICK = exports.BUILDING_COSTS = exports.PLAYER_COLORS = void 0;
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
// ── Building costs (in gold) ─────────────────────────────────────────────────
// Gold income: 100/tick humans, 50/tick bots → ~1000g/sec
exports.BUILDING_COSTS = {
    defensePost: 2_000, // ~20s — cheap early defense
    port: 4_000, // ~40s — coastal gold income
    city: 8_000, // ~80s — large troop cap boost
    factory: 8_000, // ~80s — troop growth multiplier
    sam: 20_000, // ~200s — anti-nuke defense
    silo: 40_000, // ~400s — nuclear strike capability
};
// ── Building effects per tick ────────────────────────────────────────────────
exports.BUILDING_GOLD_PER_TICK = {
    defensePost: 0,
    port: 30, // coastal trade income
    city: 0, // capacity bonus, not gold
    factory: 0,
    sam: 0,
    silo: 0,
};
// Bonus to maxTroops formula's constant term
exports.BUILDING_MAX_TROOP_BONUS = {
    defensePost: 0,
    port: 0,
    city: 250_000, // matches original: +250K per city
    factory: 0,
    sam: 0,
    silo: 0,
};
// Troop growth multiplier (stacks multiplicatively for factory)
exports.BUILDING_GROWTH_MULT = {
    defensePost: 1,
    port: 1,
    city: 1,
    factory: 1.4, // +40% troop growth per factory
    sam: 1,
    silo: 1,
};
// Defense post: multiplies conquest cost when tile contains one
exports.DEFENSE_POST_MULT = 5;
const GOLD_PER_TICK_HUMAN = 100;
const GOLD_PER_TICK_BOT = 50;
const STARTING_TROOPS = 25_000;
const STARTING_TROOPS_BOT = 10_000;
const VICTORY_THRESHOLD = 0.80;
// ── Max troop formula (original Openfront) ───────────────────────────────────
// maxTroops = 2 * (tiles^0.6 * 1000 + 50000) + cityCapBonus
function computeMaxTroops(tileCount, cityCapBonus, isBot) {
    const base = 2 * (Math.pow(Math.max(1, tileCount), 0.6) * 1000 + 50_000) + cityCapBonus;
    return isBot ? base / 2 : base;
}
// ── Troop growth formula (original Openfront) ────────────────────────────────
// growth = (10 + troops^0.73 / 4) * (1 - troops/maxTroops) * factoryMult
function computeTroopGrowth(troops, maxTroops, factoryMult) {
    if (maxTroops <= 0)
        return 0;
    const saturation = Math.max(0, 1 - troops / maxTroops);
    return (10 + Math.pow(Math.max(0, troops), 0.73) / 4) * saturation * factoryMult;
}
function createPlayer(id, name, colorIndex, isBot = false) {
    const troops = isBot ? STARTING_TROOPS_BOT : STARTING_TROOPS;
    const maxTroops = computeMaxTroops(1, 0, isBot);
    return {
        id,
        name,
        color: exports.PLAYER_COLORS[colorIndex % exports.PLAYER_COLORS.length],
        troops,
        maxTroops,
        troopGrowthRate: 0,
        gold: 0,
        isEliminated: false,
        tileCount: 0,
        alliances: [],
        isBot,
    };
}
function tickGame(state) {
    const newPlayers = {};
    // Count tiles per player
    const tileCounts = {};
    for (const tile of state.tiles) {
        if (tile.owner)
            tileCounts[tile.owner] = (tileCounts[tile.owner] || 0) + 1;
    }
    // Accumulate building effects per player
    const buildingGold = {};
    const buildingCapBonus = {};
    const factMult = {};
    for (const building of Object.values(state.buildings)) {
        const pid = building.ownerId;
        buildingGold[pid] = (buildingGold[pid] ?? 0) + exports.BUILDING_GOLD_PER_TICK[building.type];
        buildingCapBonus[pid] = (buildingCapBonus[pid] ?? 0) + exports.BUILDING_MAX_TROOP_BONUS[building.type];
        if (building.type === 'factory') {
            factMult[pid] = (factMult[pid] ?? 1) * exports.BUILDING_GROWTH_MULT.factory;
        }
    }
    const conquerableTiles = state.tiles.filter(t => t.type !== 'ocean' && t.type !== 'lake').length;
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
        // ── Troop growth ───────────────────────────────────────────────────────
        const capBonus = buildingCapBonus[playerId] ?? 0;
        const maxTroops = computeMaxTroops(ownedTiles, capBonus, player.isBot);
        const mult = factMult[playerId] ?? 1;
        const growth = computeTroopGrowth(player.troops, maxTroops, mult);
        player.maxTroops = Math.floor(maxTroops);
        player.troopGrowthRate = Math.round(growth);
        player.troops = Math.min(player.maxTroops, Math.floor(player.troops + growth));
        // ── Gold income ────────────────────────────────────────────────────────
        const baseGold = player.isBot ? GOLD_PER_TICK_BOT : GOLD_PER_TICK_HUMAN;
        player.gold += baseGold + (buildingGold[playerId] ?? 0);
        newPlayers[playerId] = player;
        if (conquerableTiles > 0 && ownedTiles / conquerableTiles >= VICTORY_THRESHOLD) {
            newPhase = 'ended';
            newWinnerId = playerId;
        }
    }
    return { ...state, tick: state.tick + 1, players: newPlayers, phase: newPhase, winnerId: newWinnerId };
}
function applyConquer(state, playerId, payload) {
    const player = state.players[playerId];
    if (!player || player.isEliminated)
        return { error: 'Oyuncu bulunamadı' };
    const tile = state.tiles[payload.tileId];
    if (!tile)
        return { error: 'Kare bulunamadı' };
    if (!(0, map_1.canConquer)(tile))
        return { error: 'Su kareleri fethedilemez' };
    if (tile.owner === playerId)
        return { error: 'Bu kare zaten sizin' };
    if (tile.owner && player.alliances.includes(tile.owner)) {
        return { error: 'Müttefik topraklara saldırılamaz' };
    }
    const playerTileCount = state.tiles.filter(t => t.owner === playerId).length;
    if (playerTileCount > 0) {
        const adjacentIds = (0, map_1.getAdjacentTileIds)(payload.tileId, state.mapWidth, state.mapHeight);
        if (!adjacentIds.some(id => state.tiles[id]?.owner === playerId)) {
            return { error: 'Komşu bir kareye sahip olmalısınız' };
        }
    }
    let conquestCost = (0, map_1.getConquestCost)(tile);
    // Defense post multiplier
    if (state.buildings[payload.tileId]?.type === 'defensePost') {
        conquestCost *= exports.DEFENSE_POST_MULT;
    }
    const availableTroops = Math.floor(player.troops * payload.percentage);
    if (availableTroops < conquestCost) {
        return { error: `Yeterli asker yok. Gerekli: ${conquestCost}, mevcut: ${availableTroops}` };
    }
    const newTiles = [...state.tiles];
    newTiles[payload.tileId] = { ...tile, owner: playerId, troops: 0 };
    let newBuildings = state.buildings;
    if (state.buildings[payload.tileId]) {
        newBuildings = { ...state.buildings };
        delete newBuildings[payload.tileId]; // captured buildings are destroyed
    }
    const newPlayers = { ...state.players };
    newPlayers[playerId] = { ...player, troops: Math.max(0, player.troops - conquestCost) };
    // Damage defending player proportional to troops on the tile
    if (tile.owner && state.players[tile.owner]) {
        const defender = state.players[tile.owner];
        const defenderLoss = Math.floor(conquestCost * 0.5);
        newPlayers[tile.owner] = { ...defender, troops: Math.max(0, defender.troops - defenderLoss) };
    }
    return { ...state, tiles: newTiles, players: newPlayers, buildings: newBuildings };
}
function applyBuild(state, playerId, payload) {
    const player = state.players[playerId];
    if (!player || player.isEliminated)
        return { error: 'Oyuncu bulunamadı' };
    const tile = state.tiles[payload.tileId];
    if (!tile)
        return { error: 'Kare bulunamadı' };
    if (tile.owner !== playerId)
        return { error: 'Bu kare size ait değil' };
    if (!(0, map_1.canConquer)(tile))
        return { error: 'Su karelerine bina kurulamaz' };
    if (state.buildings[payload.tileId])
        return { error: 'Burada zaten bir bina var' };
    const cost = exports.BUILDING_COSTS[payload.buildingType];
    if (player.gold < cost) {
        return { error: `Yeterli altın yok. Gerekli: ${cost.toLocaleString('tr')}, mevcut: ${Math.floor(player.gold).toLocaleString('tr')}` };
    }
    if (payload.buildingType === 'port') {
        const adjIds = (0, map_1.getAdjacentTileIds)(payload.tileId, state.mapWidth, state.mapHeight);
        const isCoastal = adjIds.some(id => {
            const adj = state.tiles[id];
            return adj && map_1.WATER_TILE_TYPES.has(adj.type);
        });
        if (!isCoastal)
            return { error: 'Liman yalnızca kıyı karelerine kurulabilir' };
    }
    const newBuildings = {
        ...state.buildings,
        [payload.tileId]: { tileId: payload.tileId, type: payload.buildingType, ownerId: playerId },
    };
    const newPlayers = { ...state.players, [playerId]: { ...player, gold: player.gold - cost } };
    return { ...state, buildings: newBuildings, players: newPlayers };
}
function applyAlliance(state, playerA, playerB) {
    const a = state.players[playerA], b = state.players[playerB];
    if (!a || !b)
        return state;
    return {
        ...state,
        players: {
            ...state.players,
            [playerA]: { ...a, alliances: [...new Set([...a.alliances, playerB])] },
            [playerB]: { ...b, alliances: [...new Set([...b.alliances, playerA])] },
        },
    };
}
function breakAlliance(state, playerA, playerB) {
    const a = state.players[playerA], b = state.players[playerB];
    if (!a || !b)
        return state;
    return {
        ...state,
        players: {
            ...state.players,
            [playerA]: { ...a, alliances: a.alliances.filter(id => id !== playerB) },
            [playerB]: { ...b, alliances: b.alliances.filter(id => id !== playerA) },
        },
    };
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
    // SAM interception — any SAM within 15 tiles of target intercepts
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
            delete nb[payload.siloTileId];
            return { success: true, intercepted: true, interceptedAt: b.tileId, state: { ...state, buildings: nb } };
        }
    }
    // Nuke hits — blast radius 8 tiles, tiles revert to neutral, troops damaged
    const RADIUS = 8;
    const newTiles = [...state.tiles];
    const newPlayers = { ...state.players };
    for (const tile of state.tiles) {
        const dx = tile.x - targetTile.x, dy = tile.y - targetTile.y;
        if (Math.sqrt(dx * dx + dy * dy) <= RADIUS && tile.owner) {
            const owner = newPlayers[tile.owner];
            if (owner) {
                newPlayers[tile.owner] = { ...owner, troops: Math.max(500, Math.floor(owner.troops * 0.65)) };
            }
            newTiles[tile.id] = { ...tile, owner: null, troops: 0 };
        }
    }
    const newBuildings = { ...state.buildings };
    delete newBuildings[payload.siloTileId];
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