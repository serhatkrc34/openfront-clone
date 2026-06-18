import { Application } from 'pixi.js';
import { GameClient } from './gameClient';
import { Renderer } from './renderer';
import {
  GameState,
  Tile,
  getAdjacentTileIds,
  getConquestCost,
  canConquer,
} from '@openfront/core';

// UI elements
const connectingOverlay = document.getElementById('connecting-overlay')!;
const gameoverOverlay  = document.getElementById('gameover-overlay')!;
const gameoverTitle    = document.getElementById('gameover-title')!;
const gameoverMsg      = document.getElementById('gameover-msg')!;
const playerNameEl     = document.getElementById('player-name')!;
const statTroops       = document.getElementById('stat-troops')!;
const statWorkers      = document.getElementById('stat-workers')!;
const statPop          = document.getElementById('stat-pop')!;
const statGold         = document.getElementById('stat-gold')!;
const statTiles        = document.getElementById('stat-tiles')!;
const lbList           = document.getElementById('lb-list')!;
const troopSlider      = document.getElementById('troop-slider') as HTMLInputElement;
const troopPctLabel    = document.getElementById('troop-pct-label')!;
const statusMsg        = document.getElementById('status-msg')!;
const tileTooltip      = document.getElementById('tile-tooltip')!;
const attackIndicator  = document.getElementById('attack-indicator')!;

let statusTimeout: ReturnType<typeof setTimeout> | null = null;

function showStatus(msg: string, isError = true): void {
  statusMsg.textContent = msg;
  statusMsg.style.color = isError ? '#ff8855' : '#88dd66';
  statusMsg.style.display = 'block';
  if (statusTimeout) clearTimeout(statusTimeout);
  statusTimeout = setTimeout(() => { statusMsg.style.display = 'none'; }, 3000);
}

function fmt(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return Math.floor(n).toString();
}

function numToHex(n: number): string {
  return '#' + n.toString(16).padStart(6, '0');
}

function updateHUD(state: GameState, playerId: string): void {
  const player = state.players[playerId];
  if (!player) return;
  playerNameEl.textContent = player.name;
  playerNameEl.style.color = numToHex(player.color);
  statTroops.textContent = fmt(player.troops);
  statWorkers.textContent = fmt(player.workers);
  statPop.textContent = fmt(player.population);
  statGold.textContent = fmt(player.gold);
  statTiles.textContent = `${player.tileCount} tile`;
}

function updateLeaderboard(state: GameState): void {
  const sorted = Object.values(state.players)
    .filter(p => !p.isEliminated)
    .sort((a, b) => b.tileCount - a.tileCount)
    .slice(0, 6);

  lbList.innerHTML = sorted.map((p, i) => `
    <div class="lb-row">
      <div class="lb-color" style="background:${numToHex(p.color)}"></div>
      <span class="lb-name">${i + 1}. ${p.name}</span>
      <span class="lb-tiles">${p.tileCount}</span>
    </div>
  `).join('');
}

function showTileTooltip(tile: Tile | null, state: GameState): void {
  if (!tile) { tileTooltip.style.display = 'none'; return; }
  const owner = tile.owner ? state.players[tile.owner]?.name ?? 'Unknown' : 'Nötr';
  const cost = canConquer(tile) ? getConquestCost(tile) : '—';
  tileTooltip.innerHTML =
    `<b>${tile.type}</b> | Yükseklik: ${tile.elevation} | Maliyet: ${cost}<br>Sahip: ${owner}`;
  tileTooltip.style.display = 'block';
}

// ─── Auto-attack engine ───────────────────────────────────────────────────────

let attackTarget: number | null = null;  // The tile the player wants to conquer
let isAttacking = false;

/**
 * BFS from attackTarget backward; finds the first tile adjacent to
 * player-owned territory that lies on the shortest path to target.
 */
function findNextStep(
  state: GameState,
  playerId: string,
  targetId: number,
): number | null {
  const { tiles, mapWidth, mapHeight } = state;
  const target = tiles[targetId];
  if (!target || target.owner === playerId) return null;

  // BFS from target; when we reach an owned tile, the previous node is next step
  const queue: number[] = [targetId];
  const visited = new Set<number>([targetId]);
  const prev = new Map<number, number>(); // node -> came_from (away from target)

  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const adjId of getAdjacentTileIds(cur, mapWidth, mapHeight)) {
      if (visited.has(adjId)) continue;
      const adj = tiles[adjId];
      if (!adj || !canConquer(adj)) continue;
      visited.add(adjId);
      prev.set(adjId, cur);
      if (adj.owner === playerId) {
        // Trace back one step toward target
        return cur; // cur is adjacent to our territory, on path to target
      }
      queue.push(adjId);
    }
  }
  return null;
}

/**
 * After a target is conquered, auto-pick the best next tile to keep expanding.
 * Returns the cheapest adjacent conquerable tile not owned by player.
 */
function pickAutoAdvance(state: GameState, playerId: string, fromTileId: number): number | null {
  const { tiles, mapWidth, mapHeight } = state;
  const adjIds = getAdjacentTileIds(fromTileId, mapWidth, mapHeight);
  const candidates = adjIds
    .map(id => tiles[id])
    .filter((t): t is Tile => !!t && canConquer(t) && t.owner !== playerId)
    .sort((a, b) => getConquestCost(a) - getConquestCost(b));
  return candidates[0]?.id ?? null;
}

function setAttackTarget(tileId: number | null, label?: string): void {
  attackTarget = tileId;
  isAttacking = tileId !== null;
  attackIndicator.style.display = tileId !== null ? 'block' : 'none';
  if (label) attackIndicator.textContent = `⚔ Hedef: ${label}`;
}

function startAutoAttackLoop(client: GameClient, getState: () => GameState | null, getPlayerId: () => string | null): void {
  setInterval(() => {
    if (!isAttacking || attackTarget === null) return;
    const state = getState();
    const playerId = getPlayerId();
    if (!state || !playerId) return;

    const player = state.players[playerId];
    if (!player || player.isEliminated) { setAttackTarget(null); return; }

    const target = state.tiles[attackTarget];
    if (!target) { setAttackTarget(null); return; }

    // Target already conquered — auto-advance
    if (target.owner === playerId) {
      const next = pickAutoAdvance(state, playerId, attackTarget);
      if (next !== null) {
        setAttackTarget(next, state.tiles[next].type);
      } else {
        setAttackTarget(null);
        showStatus('Genişleme tamamlandı — yeni hedef seç.', false);
      }
      return;
    }

    if (!canConquer(target)) { setAttackTarget(null); return; }

    // Find next step on BFS path to target
    const nextStep = findNextStep(state, playerId, attackTarget);
    if (nextStep === null) {
      setAttackTarget(null);
      showStatus('Hedefe ulaşılamıyor.', true);
      return;
    }

    const stepTile = state.tiles[nextStep];
    const cost = getConquestCost(stepTile);
    const pct = Number(troopSlider.value) / 100;
    const available = Math.floor(player.troops * pct);

    if (available >= cost) {
      client.sendConquer(nextStep, pct);
    }
    // else: not enough troops yet — wait silently until next interval
  }, 450);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const app = new Application();
  await app.init({
    resizeTo: window,
    backgroundColor: 0x0a0a0f,
    antialias: false,
    resolution: 1,
  });

  const gameCanvas = document.getElementById('game-canvas')!;
  gameCanvas.appendChild(app.canvas);

  const renderer = new Renderer(app);
  const client = new GameClient();

  let currentState: GameState | null = null;
  let myPlayerId: string | null = null;

  troopSlider.addEventListener('input', () => {
    troopPctLabel.textContent = troopSlider.value + '%';
  });

  document.addEventListener('mousemove', (e: MouseEvent) => {
    if (tileTooltip.style.display !== 'none') {
      tileTooltip.style.left = (e.clientX + 14) + 'px';
      tileTooltip.style.top = (e.clientY - 10) + 'px';
    }
  });

  renderer.setOnTileHover((tile) => {
    if (currentState) showTileTooltip(tile, currentState);
  });

  renderer.setOnTileClick((tileId) => {
    if (!currentState || !myPlayerId) return;
    const tile = currentState.tiles[tileId];
    if (!tile) return;

    // Click own tile = cancel attack
    if (tile.owner === myPlayerId) {
      setAttackTarget(null);
      showStatus('Saldırı iptal edildi.', false);
      renderer.clearAttackTarget();
      return;
    }

    if (!canConquer(tile)) {
      showStatus('Su tile\'ları fethedilemez.');
      return;
    }

    // Set as attack target — auto-expand loop handles the rest
    setAttackTarget(tileId, tile.type);
    renderer.setAttackTargetId(tileId);
    showStatus(`Hedef belirlendi: ${tile.type}. Otomatik genişleme başlıyor…`, false);
  });

  startAutoAttackLoop(client, () => currentState, () => myPlayerId);

  client.onConnect((playerId, state) => {
    myPlayerId = playerId;
    currentState = state;
    connectingOverlay.style.display = 'none';
    renderer.setState(state, playerId);
    updateHUD(state, playerId);
    updateLeaderboard(state);
    showStatus('Bağlandı! Haritada bir hedefe tıkla — otomatik genişler.', false);
  });

  client.onState((state) => {
    currentState = state;
    if (!myPlayerId) return;
    renderer.updateState(state);
    updateHUD(state, myPlayerId);
    updateLeaderboard(state);

    if (state.phase === 'ended') {
      const winner = state.winnerId ? state.players[state.winnerId] : null;
      gameoverOverlay.style.display = 'flex';
      if (state.winnerId === myPlayerId) {
        gameoverTitle.textContent = 'Zafer!';
        gameoverMsg.textContent = 'Toprağın %80\'ine hükmettin!';
      } else {
        gameoverTitle.textContent = 'Oyun Bitti';
        gameoverMsg.textContent = `${winner?.name ?? 'Birisi'} kazandı.`;
      }
    }

    const me = state.players[myPlayerId];
    if (me?.isEliminated) {
      setAttackTarget(null);
      showStatus('Elendi! Tüm toprakların kaybedildi.');
    }
  });

  client.onTickUpdate((tick, players) => {
    if (!myPlayerId || !currentState) return;
    currentState = { ...currentState, tick, players };
    updateHUD(currentState, myPlayerId);
    updateLeaderboard(currentState);
  });

  client.onServerError((msg) => {
    showStatus(msg);
  });

  client.onDisconnect(() => {
    setAttackTarget(null);
    connectingOverlay.style.display = 'flex';
    connectingOverlay.querySelector('p')!.textContent = 'Bağlantı kesildi. Yeniden bağlanılıyor…';
    setTimeout(() => client.connect(getWsUrl()), 2000);
  });

  client.connect(getWsUrl());
}

function getWsUrl(): string {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = location.hostname;
  const port = import.meta.env.DEV ? '3001' : location.port;
  return `${protocol}//${host}:${port}`;
}

main().catch(console.error);
