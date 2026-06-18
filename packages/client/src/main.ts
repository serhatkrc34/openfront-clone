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
const connectingOverlay  = document.getElementById('connecting-overlay')!;
const connectSpinner     = document.getElementById('connect-spinner')!;
const connectStatus      = document.getElementById('connect-status')!;
const playerNameInput    = document.getElementById('player-name-input') as HTMLInputElement;
const joinBtn            = document.getElementById('join-btn')!;
const gameoverOverlay    = document.getElementById('gameover-overlay')!;
const gameoverTitle      = document.getElementById('gameover-title')!;
const gameoverMsg        = document.getElementById('gameover-msg')!;
const playerNameEl       = document.getElementById('player-name')!;
const statTroops         = document.getElementById('stat-troops')!;
const statWorkers        = document.getElementById('stat-workers')!;
const statPop            = document.getElementById('stat-pop')!;
const statGold           = document.getElementById('stat-gold')!;
const statTiles          = document.getElementById('stat-tiles')!;
const lbList             = document.getElementById('lb-list')!;
const gameTimerEl        = document.getElementById('game-timer')!;
const troopSlider        = document.getElementById('troop-slider') as HTMLInputElement;
const troopPctLabel      = document.getElementById('troop-pct-label')!;
const statusMsg          = document.getElementById('status-msg')!;
const tileTooltip        = document.getElementById('tile-tooltip')!;
const attackIndicator    = document.getElementById('attack-indicator')!;

let statusTimeout: ReturnType<typeof setTimeout> | null = null;
let gameStartTime: number | null = null;
let timerInterval: ReturnType<typeof setInterval> | null = null;
let myPlayerId: string | null = null;

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
  const totalLand = state.tiles.filter(t => t.type !== 'ocean' && t.type !== 'lake').length;
  const sorted = Object.values(state.players)
    .filter(p => !p.isEliminated)
    .sort((a, b) => b.tileCount - a.tileCount)
    .slice(0, 8);

  lbList.innerHTML = sorted.map((p, i) => {
    const pct = totalLand > 0 ? ((p.tileCount / totalLand) * 100).toFixed(1) : '0.0';
    const isMe = p.id === myPlayerId;
    return `<tr class="${isMe ? 'lb-me' : ''}">
      <td>${i + 1}</td>
      <td><div class="lb-player-cell"><span class="lb-dot" style="background:${numToHex(p.color)}"></span><span class="lb-player-name">${p.name}</span></div></td>
      <td class="lb-pct">${pct}%</td>
      <td class="lb-gold">${fmt(p.gold)}</td>
      <td class="lb-troops">${fmt(p.troops)}</td>
    </tr>`;
  }).join('');
}

function updateTimer(): void {
  if (!gameStartTime) return;
  const elapsed = Math.floor((Date.now() - gameStartTime) / 1000);
  const mm = Math.floor(elapsed / 60).toString().padStart(2, '0');
  const ss = (elapsed % 60).toString().padStart(2, '0');
  gameTimerEl.textContent = `${mm}:${ss}`;
}

function showTileTooltip(tile: Tile | null, state: GameState): void {
  if (!tile) { tileTooltip.style.display = 'none'; return; }
  const owner = tile.owner ? state.players[tile.owner]?.name ?? 'Unknown' : 'Nötr';
  const cost = canConquer(tile) ? getConquestCost(tile) : '—';
  tileTooltip.innerHTML =
    `<b>${tile.type}</b> | Yükseklik: ${tile.elevation} | Maliyet: ${cost}<br>Sahip: ${owner}`;
  tileTooltip.style.display = 'block';
}

// ─── Multi-target auto-attack engine ─────────────────────────────────────────

// Map from targetTileId → label string
const attackTargets = new Map<number, string>();

function findNextStep(state: GameState, playerId: string, targetId: number): number | null {
  const { tiles, mapWidth, mapHeight } = state;
  const target = tiles[targetId];
  if (!target || target.owner === playerId) return null;

  const queue: number[] = [targetId];
  const visited = new Set<number>([targetId]);

  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const adjId of getAdjacentTileIds(cur, mapWidth, mapHeight)) {
      if (visited.has(adjId)) continue;
      const adj = tiles[adjId];
      if (!adj || !canConquer(adj)) continue;
      visited.add(adjId);
      if (adj.owner === playerId) return cur;
      queue.push(adjId);
    }
  }
  return null;
}

function pickAutoAdvance(state: GameState, playerId: string, fromTileId: number): number | null {
  const { tiles, mapWidth, mapHeight } = state;
  const adjIds = getAdjacentTileIds(fromTileId, mapWidth, mapHeight);
  const candidates = adjIds
    .map(id => tiles[id])
    .filter((t): t is Tile => !!t && canConquer(t) && t.owner !== playerId)
    .sort((a, b) => getConquestCost(a) - getConquestCost(b));
  return candidates[0]?.id ?? null;
}

function syncAttackUI(renderer: import('./renderer').Renderer): void {
  const count = attackTargets.size;
  attackIndicator.style.display = count > 0 ? 'block' : 'none';
  attackIndicator.textContent = count === 1
    ? `⚔ Hedef: ${[...attackTargets.values()][0]}`
    : count > 1 ? `⚔ ${count} Hedef Aktif` : '';
  renderer.setAttackTargetIds([...attackTargets.keys()]);
}

function startAutoAttackLoop(
  client: GameClient,
  renderer: import('./renderer').Renderer,
  getState: () => GameState | null,
  getPlayerId: () => string | null,
): void {
  setInterval(() => {
    if (attackTargets.size === 0) return;
    const state = getState();
    const playerId = getPlayerId();
    if (!state || !playerId) return;

    const player = state.players[playerId];
    if (!player || player.isEliminated) {
      attackTargets.clear();
      syncAttackUI(renderer);
      return;
    }

    const pct = Number(troopSlider.value) / 100;
    let changed = false;

    for (const [targetId, label] of [...attackTargets]) {
      const target = state.tiles[targetId];

      // Target gone or unconquerable
      if (!target || !canConquer(target)) {
        attackTargets.delete(targetId);
        changed = true;
        continue;
      }

      // Already conquered — auto-advance to next tile from this direction
      if (target.owner === playerId) {
        const next = pickAutoAdvance(state, playerId, targetId);
        attackTargets.delete(targetId);
        changed = true;
        if (next !== null) {
          attackTargets.set(next, state.tiles[next].type);
        }
        continue;
      }

      // Find next step toward this target via BFS
      const nextStep = findNextStep(state, playerId, targetId);
      if (nextStep === null) {
        attackTargets.delete(targetId);
        changed = true;
        continue;
      }

      const stepTile = state.tiles[nextStep];
      const cost = getConquestCost(stepTile);
      const available = Math.floor(player.troops * pct);
      if (available >= cost) {
        client.sendConquer(nextStep, pct);
      }
    }

    if (changed) syncAttackUI(renderer);
  }, 150);
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

    // Click own tile → clear all targets
    if (tile.owner === myPlayerId) {
      attackTargets.clear();
      syncAttackUI(renderer);
      showStatus('Tüm hedefler iptal edildi.', false);
      return;
    }

    if (!canConquer(tile)) {
      showStatus('Su tile\'ları fethedilemez.');
      return;
    }

    // Add this tile as a new attack target (accumulate up to 8)
    if (attackTargets.size >= 8) {
      const first = attackTargets.keys().next().value as number;
      attackTargets.delete(first);
    }
    attackTargets.set(tileId, tile.type);
    syncAttackUI(renderer);
    showStatus(
      attackTargets.size === 1
        ? `Hedef: ${tile.type} — Otomatik genişleme başlıyor…`
        : `${attackTargets.size} hedef aktif. Kendi toprağına tıkla → iptal.`,
      false,
    );
  });

  startAutoAttackLoop(client, renderer, () => currentState, () => myPlayerId);

  // ─── Name input + join flow ─────────────────────────────────────────────────

  function doJoin(): void {
    const name = playerNameInput.value.trim();
    joinBtn.setAttribute('disabled', 'true');
    connectSpinner.style.display = 'block';
    connectStatus.style.display = 'block';
    connectStatus.textContent = 'Sunucuya bağlanılıyor...';
    client.connect(getWsUrl());
    // After PLAYER_JOIN fires, we'll send the name
    if (name) {
      // stored so onConnect handler can use it
      (client as unknown as { _pendingName: string })._pendingName = name;
    }
  }

  joinBtn.addEventListener('click', doJoin);
  playerNameInput.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter') doJoin();
  });

  // ─── Client callbacks ───────────────────────────────────────────────────────

  client.onConnect((playerId, state) => {
    myPlayerId = playerId;
    currentState = state;

    // Send custom name if set
    const pendingName = (client as unknown as { _pendingName?: string })._pendingName;
    if (pendingName) {
      client.sendSetName(pendingName);
    }

    connectingOverlay.style.display = 'none';
    renderer.setState(state, playerId);
    updateHUD(state, playerId);
    updateLeaderboard(state);

    gameStartTime = Date.now();
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(updateTimer, 1000);

    showStatus('Bağlandı! Haritada bir hedefe tıkla — otomatik genişler.', false);
  });

  client.onState((state) => {
    currentState = state;
    if (!myPlayerId) return;
    renderer.updateState(state);
    updateHUD(state, myPlayerId);
    updateLeaderboard(state);

    if (state.phase === 'ended') {
      if (timerInterval) clearInterval(timerInterval);
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
      attackTargets.clear();
      syncAttackUI(renderer);
      showStatus('Elendi! Tüm toprakların kaybedildi.');
    }
  });

  client.onTickUpdate((tick, players) => {
    if (!myPlayerId || !currentState) return;
    currentState = { ...currentState, tick, players };
    updateHUD(currentState, myPlayerId);
    updateLeaderboard(currentState);
    renderer.updatePlayers(players);
  });

  client.onServerError((msg) => {
    showStatus(msg);
  });

  client.onDisconnect(() => {
    attackTargets.clear();
    syncAttackUI(renderer);
    if (timerInterval) clearInterval(timerInterval);
    connectingOverlay.style.display = 'flex';
    connectSpinner.style.display = 'block';
    connectStatus.style.display = 'block';
    connectStatus.textContent = 'Bağlantı kesildi. Yeniden bağlanılıyor…';
    joinBtn.removeAttribute('disabled');
    setTimeout(() => client.connect(getWsUrl()), 2000);
  });
}

function getWsUrl(): string {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = location.hostname;
  const port = import.meta.env.DEV ? '3001' : location.port;
  return `${protocol}//${host}:${port}`;
}

main().catch(console.error);
