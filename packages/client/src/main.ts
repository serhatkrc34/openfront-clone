import { Application } from 'pixi.js';
import { GameClient } from './gameClient';
import { Renderer } from './renderer';
import {
  GameState,
  Tile,
  BuildingType,
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
const statGrowth         = document.getElementById('stat-growth')!;
const statMaxTroops      = document.getElementById('stat-max-troops')!;
const troopBarFill       = document.getElementById('troop-bar-fill')!;
const statGold           = document.getElementById('stat-gold')!;
const statTiles          = document.getElementById('stat-tiles')!;
const lbList             = document.getElementById('lb-list')!;
const gameTimerEl        = document.getElementById('game-timer')!;
const troopSlider        = document.getElementById('troop-slider') as HTMLInputElement;
const troopPctLabel      = document.getElementById('troop-pct-label')!;
const statusMsg          = document.getElementById('status-msg')!;
const tileTooltip        = document.getElementById('tile-tooltip')!;
const attackIndicator    = document.getElementById('attack-indicator')!;
const contextMenu        = document.getElementById('context-menu')!;
const allianceNotif      = document.getElementById('alliance-notification')!;
const buildPanel         = document.getElementById('build-panel')!;
const modeHint           = document.getElementById('mode-hint')!;
const nukeBtn            = document.getElementById('nuke-btn')!;
const buildBtns          = document.querySelectorAll<HTMLButtonElement>('.bld-btn[data-type]');

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
  statMaxTroops.textContent = `/ ${fmt(player.maxTroops)}`;
  const pct = player.maxTroops > 0 ? (player.troops / player.maxTroops) * 100 : 0;
  (troopBarFill as HTMLElement).style.width = `${Math.min(100, pct).toFixed(1)}%`;
  const growthTxt = `+${fmt(player.troopGrowthRate)}/t`;
  statGrowth.textContent = growthTxt;
  statGrowth.className = 'growth-rate';
  statGold.textContent = fmt(player.gold);
  statTiles.textContent = `${player.tileCount} kare`;
}

function updateLeaderboard(state: GameState): void {
  const totalLand = state.tiles.filter(t => t.type !== 'ocean' && t.type !== 'lake').length;
  const sorted = Object.values(state.players)
    .filter(p => !p.isEliminated)
    .sort((a, b) => b.tileCount - a.tileCount)
    .slice(0, 8);

  const myPlayer = myPlayerId ? state.players[myPlayerId] : null;

  lbList.innerHTML = sorted.map((p, i) => {
    const pct = totalLand > 0 ? ((p.tileCount / totalLand) * 100).toFixed(1) : '0.0';
    const isMe = p.id === myPlayerId;
    const isAllied = myPlayer?.alliances.includes(p.id) ?? false;
    const allianceBadge = isAllied ? ' <span style="color:#44ffcc">🤝</span>' : '';
    return `<tr class="${isMe ? 'lb-me' : ''}">
      <td>${i + 1}</td>
      <td><div class="lb-player-cell"><span class="lb-dot" style="background:${numToHex(p.color)}"></span><span class="lb-player-name">${p.name}${allianceBadge}</span></div></td>
      <td class="lb-pct">${pct}%</td>
      <td class="lb-gold">${fmt(p.gold)}</td>
      <td class="lb-troops">${fmt(p.maxTroops)}</td>
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
  const bld = state.buildings[tile.id];
  const bldText = bld ? ` | Yapı: ${bld.type}` : '';
  tileTooltip.innerHTML =
    `<b>${tile.type}</b> | Yükseklik: ${tile.elevation} | Maliyet: ${cost}${bldText}<br>Sahip: ${owner}`;
  tileTooltip.style.display = 'block';
}

// ─── Build & nuke mode ───────────────────────────────────────────────────────

let buildMode: BuildingType | null = null;
let nukePhase: 'idle' | 'select_silo' | 'select_target' = 'idle';
let nukeSiloTileId: number | null = null;

const BUILDING_COSTS_UI: Record<BuildingType, number> = {
  defensePost: 2_000,
  port:        4_000,
  city:        8_000,
  factory:     8_000,
  sam:        20_000,
  silo:       40_000,
};

function setModeHint(text: string, isNuke = false): void {
  if (!text) {
    modeHint.style.display = 'none';
    return;
  }
  modeHint.textContent = `${text}  [ESC iptal]`;
  modeHint.className = isNuke ? 'nuke-mode' : '';
  modeHint.style.display = 'block';
}

function exitSpecialMode(): void {
  buildMode = null;
  nukePhase = 'idle';
  nukeSiloTileId = null;
  modeHint.style.display = 'none';
  buildBtns.forEach(b => b.classList.remove('active'));
  nukeBtn.classList.remove('active');
}

function enterBuildMode(type: BuildingType): void {
  if (buildMode === type) { exitSpecialMode(); return; }
  exitSpecialMode();
  buildMode = type;
  const nameMap: Record<BuildingType, string> = {
    defensePost: 'Kale', port: 'Liman', city: 'Şehir', factory: 'Fabrika', sam: 'Hava Savunma', silo: 'Nükleer Silo',
  };
  setModeHint(`${nameMap[type]} inşa et: Kendi toprağında bir kareye tıkla`);
  document.getElementById(`btn-${type}`)?.classList.add('active');
}

function enterNukeMode(): void {
  exitSpecialMode();
  nukePhase = 'select_silo';
  setModeHint('Silonuzu seçin: Nükleer silo karenize tıklayın', true);
  nukeBtn.classList.add('active');
}

function updateBuildPanel(state: GameState | null, playerId: string | null): void {
  if (!state || !playerId) return;
  const player = state.players[playerId];
  if (!player) return;
  const gold = Math.floor(player.gold);
  buildBtns.forEach(btn => {
    const type = btn.dataset.type as BuildingType;
    const cost = BUILDING_COSTS_UI[type] ?? Infinity;
    btn.disabled = gold < cost;
  });
  const hasSilo = Object.values(state.buildings).some(
    b => b.type === 'silo' && b.ownerId === playerId,
  );
  (nukeBtn as HTMLButtonElement).disabled = !hasSilo;
}

// ─── Context menu ─────────────────────────────────────────────────────────────

function hideContextMenu(): void {
  contextMenu.style.display = 'none';
}

function showBuildMenu(tile: Tile, x: number, y: number, state: GameState, client: GameClient): void {
  const gold = myPlayerId ? Math.floor(state.players[myPlayerId]?.gold ?? 0) : 0;
  const hasBuilding = !!state.buildings[tile.id];

  const items: { label: string; cost: number; type: BuildingType }[] = [
    { label: '🛡 Kale',         cost: 2_000,  type: 'defensePost' },
    { label: '⚓ Liman',        cost: 4_000,  type: 'port' },
    { label: '🏙 Şehir',        cost: 8_000,  type: 'city' },
    { label: '🏭 Fabrika',      cost: 8_000,  type: 'factory' },
    { label: '🚀 Hava Savunma', cost: 20_000, type: 'sam' },
    { label: '💣 Nükleer Silo', cost: 40_000, type: 'silo' },
  ];

  const menuHtml = `
    <div class="cm-title">${hasBuilding ? 'Yapı Mevcut' : 'İnşa Et'}</div>
    ${hasBuilding
      ? `<div class="cm-disabled">Bu bölgede zaten yapı var</div>`
      : items.map(it => {
          const canAfford = gold >= it.cost;
          const cls = canAfford ? 'cm-item' : 'cm-item cm-disabled';
          return `<button class="${cls}" data-type="${it.type}">${it.label} <span class="cm-cost">${it.cost}g</span></button>`;
        }).join('')
    }
  `;

  contextMenu.innerHTML = menuHtml;
  contextMenu.style.left = `${Math.min(x, window.innerWidth - 160)}px`;
  contextMenu.style.top = `${Math.min(y, window.innerHeight - 200)}px`;
  contextMenu.style.display = 'block';

  contextMenu.querySelectorAll<HTMLButtonElement>('button.cm-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const type = btn.dataset.type as BuildingType;
      client.sendBuild(tile.id, type);
      hideContextMenu();
    });
  });
}

function showEnemyMenu(tile: Tile, x: number, y: number, state: GameState, client: GameClient): void {
  const owner = tile.owner ? state.players[tile.owner] : null;
  if (!owner || !myPlayerId) { hideContextMenu(); return; }

  const myPlayer = state.players[myPlayerId];
  const isAllied = myPlayer?.alliances.includes(owner.id) ?? false;

  const menuHtml = `
    <div class="cm-title" style="color:${numToHex(owner.color)}">${owner.name}</div>
    ${isAllied
      ? `<button class="cm-item" data-action="break">❌ İttifakı Boz</button>`
      : `<button class="cm-item" data-action="ally">🤝 İttifak Teklif Et</button>`
    }
  `;

  contextMenu.innerHTML = menuHtml;
  contextMenu.style.left = `${Math.min(x, window.innerWidth - 160)}px`;
  contextMenu.style.top = `${Math.min(y, window.innerHeight - 120)}px`;
  contextMenu.style.display = 'block';

  const btn = contextMenu.querySelector<HTMLButtonElement>('button.cm-item');
  btn?.addEventListener('click', () => {
    const action = btn.dataset.action;
    if (action === 'ally') {
      client.sendProposeAlliance(owner.id);
      showStatus(`${owner.name}'e ittifak teklif edildi`, false);
    } else if (action === 'break') {
      // Break alliance: propose and immediately have server handle it
      // For now, just send a new conquer to signal intent (alliance break auto on attack)
      showStatus(`${owner.name} ile ittifak bozuldu`, true);
    }
    hideContextMenu();
  });
}

// ─── Alliance notification ────────────────────────────────────────────────────

let pendingAllianceFrom: { id: string; name: string; color: number } | null = null;

function showAllianceNotification(fromId: string, fromName: string, fromColor: number, client: GameClient): void {
  pendingAllianceFrom = { id: fromId, name: fromName, color: fromColor };
  const notifEl = allianceNotif;
  notifEl.innerHTML = `
    <span style="color:${numToHex(fromColor)};font-weight:700">${fromName}</span>
    <span> ittifak teklif ediyor</span>
    <div class="ally-btns">
      <button id="ally-accept" class="ally-btn ally-accept">✓ Kabul</button>
      <button id="ally-decline" class="ally-btn ally-decline">✗ Reddet</button>
    </div>
  `;
  notifEl.style.display = 'flex';

  document.getElementById('ally-accept')?.addEventListener('click', () => {
    if (pendingAllianceFrom) {
      client.sendAllianceResponse(pendingAllianceFrom.id, true);
      showStatus('İttifak kabul edildi!', false);
    }
    notifEl.style.display = 'none';
    pendingAllianceFrom = null;
  });

  document.getElementById('ally-decline')?.addEventListener('click', () => {
    if (pendingAllianceFrom) {
      client.sendAllianceResponse(pendingAllianceFrom.id, false);
    }
    notifEl.style.display = 'none';
    pendingAllianceFrom = null;
  });

  // Auto-dismiss after 30 seconds (server also expires it)
  setTimeout(() => {
    notifEl.style.display = 'none';
    pendingAllianceFrom = null;
  }, 30000);
}

// ─── Directional tile-targeting auto-attack engine ───────────────────────────

// Map from target tile ID → label string (the tile you clicked toward)
const attackTargets = new Map<number, string>();

// BFS backward from targetId — returns the adjacent-to-player tile to attack next
function findNextStep(state: GameState, playerId: string, targetId: number): number | null {
  const { tiles, mapWidth, mapHeight } = state;
  const queue: number[] = [targetId];
  const visited = new Set<number>([targetId]);

  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const adjId of getAdjacentTileIds(cur, mapWidth, mapHeight)) {
      if (visited.has(adjId)) continue;
      const adj = tiles[adjId];
      if (!adj || !canConquer(adj)) continue;
      visited.add(adjId);
      if (adj.owner === playerId) return cur; // cur is the tile to attack next
      queue.push(adjId);
    }
  }
  return null;
}

// When we reach the target, keep advancing — pick the cheapest adjacent unconquered tile
function pickAutoAdvance(state: GameState, playerId: string, fromTileId: number): number | null {
  const { tiles, mapWidth, mapHeight } = state;
  const adjIds = getAdjacentTileIds(fromTileId, mapWidth, mapHeight);
  const candidates = adjIds
    .map(id => tiles[id])
    .filter((t): t is Tile => !!t && canConquer(t) && t.owner !== playerId)
    .sort((a, b) => getConquestCost(a) - getConquestCost(b));
  return candidates[0]?.id ?? null;
}

function syncAttackUI(renderer: import('./renderer').Renderer, state: GameState | null): void {
  const count = attackTargets.size;
  attackIndicator.style.display = count > 0 ? 'block' : 'none';
  if (count === 1) {
    attackIndicator.textContent = `⚔ Hedef: ${[...attackTargets.values()][0]}`;
  } else if (count > 1) {
    attackIndicator.textContent = `⚔ ${count} Hedef Aktif`;
  }
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
      syncAttackUI(renderer, state);
      return;
    }

    const { tiles } = state;
    const pct = Number(troopSlider.value) / 100;
    let changed = false;

    for (const [targetId, label] of [...attackTargets]) {
      const target = tiles[targetId];

      // Target gone or not conquerable
      if (!target || !canConquer(target)) {
        attackTargets.delete(targetId);
        changed = true;
        continue;
      }

      // Already conquered — auto-advance to keep pushing in the same direction
      if (target.owner === playerId) {
        const next = pickAutoAdvance(state, playerId, targetId);
        attackTargets.delete(targetId);
        changed = true;
        if (next !== null) {
          attackTargets.set(next, tiles[next].type);
        }
        continue;
      }

      // BFS: find the next tile to attack on the path toward this target
      const nextStep = findNextStep(state, playerId, targetId);
      if (nextStep === null) {
        attackTargets.delete(targetId);
        changed = true;
        continue;
      }

      const stepTile = tiles[nextStep];
      const cost = getConquestCost(stepTile);
      const available = Math.floor(player.troops * pct);
      if (available >= cost) {
        client.sendConquer(nextStep, pct);
      }
    }

    if (changed) syncAttackUI(renderer, state);
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

  const troopPctVal     = document.getElementById('troop-pct-val')!;
  const troopCountLabel = document.getElementById('troop-count-label')!;

  function updateSliderLabel(): void {
    const pct = Number(troopSlider.value);
    troopPctVal.textContent = `${pct}%`;
    const troops = myPlayerId && currentState ? (currentState.players[myPlayerId]?.troops ?? 0) : 0;
    troopCountLabel.textContent = fmt(Math.floor(troops * pct / 100));
  }

  troopSlider.addEventListener('input', updateSliderLabel);

  document.addEventListener('mousemove', (e: MouseEvent) => {
    if (tileTooltip.style.display !== 'none') {
      tileTooltip.style.left = (e.clientX + 14) + 'px';
      tileTooltip.style.top = (e.clientY - 10) + 'px';
    }
  });

  // Hide context menu on click outside
  document.addEventListener('click', (e: MouseEvent) => {
    if (!contextMenu.contains(e.target as Node)) {
      hideContextMenu();
    }
  });

  renderer.setOnTileHover((tile) => {
    if (currentState) showTileTooltip(tile, currentState);
  });

  renderer.setOnTileClick((tileId) => {
    hideContextMenu();
    if (!currentState || !myPlayerId) return;
    const tile = currentState.tiles[tileId];
    if (!tile) return;

    // ── Build mode ─────────────────────────────────────────────────────────
    if (buildMode !== null) {
      if (tile.owner !== myPlayerId) {
        showStatus('Yalnızca kendi toprağına bina kurabilirsin.');
        return;
      }
      if (currentState.buildings[tileId]) {
        showStatus('Bu karede zaten bir bina var.');
        return;
      }
      client.sendBuild(tileId, buildMode);
      showStatus(`${buildMode} inşa edildi!`, false);
      exitSpecialMode();
      return;
    }

    // ── Nuke mode ──────────────────────────────────────────────────────────
    if (nukePhase === 'select_silo') {
      const bld = currentState.buildings[tileId];
      if (!bld || bld.type !== 'silo' || bld.ownerId !== myPlayerId) {
        showStatus('Kendi nükleer silonuzu seçin.');
        return;
      }
      nukeSiloTileId = tileId;
      nukePhase = 'select_target';
      setModeHint('Hedef seçin: Herhangi bir kareye tıklayın', true);
      return;
    }

    if (nukePhase === 'select_target') {
      if (!canConquer(tile) && tile.type !== 'ocean' && tile.type !== 'lake') {
        // allow any land tile as target
      }
      if (tile.owner && myPlayerId) {
        const myPlayer = currentState.players[myPlayerId];
        if (myPlayer?.alliances.includes(tile.owner)) {
          showStatus('Müttefik toprağına nükleer atılamaz!');
          return;
        }
      }
      client.sendNuke(nukeSiloTileId!, tileId);
      showStatus('Nükleer fırlatıldı!', false);
      exitSpecialMode();
      return;
    }

    // ── Normal click ───────────────────────────────────────────────────────
    // Click own tile → clear all attack targets
    if (tile.owner === myPlayerId) {
      attackTargets.clear();
      syncAttackUI(renderer, currentState);
      showStatus('Tüm hedefler iptal edildi.', false);
      return;
    }

    if (!canConquer(tile)) {
      showStatus('Su tile\'ları fethedilemez.');
      return;
    }

    // Check alliance before targeting
    if (tile.owner) {
      const myPlayer = currentState.players[myPlayerId];
      if (myPlayer?.alliances.includes(tile.owner)) {
        showStatus(`${currentState.players[tile.owner]?.name} ile ittifak kurulu — saldıramazsın!`);
        return;
      }
    }

    // Add this tile as a directional attack target (max 8 simultaneous)
    if (attackTargets.size >= 8) {
      const first = attackTargets.keys().next().value as number;
      attackTargets.delete(first);
    }
    attackTargets.set(tileId, tile.type);
    syncAttackUI(renderer, currentState);
    showStatus(
      attackTargets.size === 1
        ? `Hedef: ${tile.type} — Otomatik ilerleme başlıyor…`
        : `${attackTargets.size} hedef aktif. Kendi toprağına tıkla → iptal.`,
      false,
    );
  });

  renderer.setOnTileRightClick((tileId, x, y) => {
    if (!currentState || !myPlayerId) return;
    const tile = currentState.tiles[tileId];
    if (!tile) return;

    if (tile.owner === myPlayerId) {
      showBuildMenu(tile, x, y, currentState, client);
    } else if (tile.owner && tile.owner !== myPlayerId) {
      showEnemyMenu(tile, x, y, currentState, client);
    } else {
      hideContextMenu();
    }
  });

  // ── Build panel buttons ─────────────────────────────────────────────────────

  buildBtns.forEach(btn => {
    btn.addEventListener('click', () => enterBuildMode(btn.dataset.type as BuildingType));
  });

  nukeBtn.addEventListener('click', () => {
    if ((nukeBtn as HTMLButtonElement).disabled) return;
    if (nukePhase !== 'idle') { exitSpecialMode(); return; }
    enterNukeMode();
  });

  document.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Escape') exitSpecialMode();
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
    if (name) {
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

    const pendingName = (client as unknown as { _pendingName?: string })._pendingName;
    if (pendingName) {
      client.sendSetName(pendingName);
    }

    connectingOverlay.style.display = 'none';
    buildPanel.style.display = 'flex';
    renderer.setState(state, playerId);
    updateHUD(state, playerId);
    updateLeaderboard(state);
    updateBuildPanel(state, playerId);

    gameStartTime = Date.now();
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(updateTimer, 1000);

    showStatus('Bağlandı! Düşman toprağına tıkla → saldır. Sol panel → bina kur.', false);
  });

  client.onState((state) => {
    currentState = state;
    if (!myPlayerId) return;
    renderer.updateState(state);
    updateHUD(state, myPlayerId);
    updateLeaderboard(state);
    updateBuildPanel(state, myPlayerId);

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
      syncAttackUI(renderer, state);
      showStatus('Elendi! Tüm toprakların kaybedildi.');
    }
  });

  client.onTickUpdate((tick, players) => {
    if (!myPlayerId || !currentState) return;
    currentState = { ...currentState, tick, players };
    updateHUD(currentState, myPlayerId);
    updateLeaderboard(currentState);
    renderer.updatePlayers(players);
    updateBuildPanel(currentState, myPlayerId);
    updateSliderLabel();
  });

  client.onServerError((msg) => {
    showStatus(msg);
  });

  client.onAllianceProposal((fromId, fromName, fromColor) => {
    showAllianceNotification(fromId, fromName, fromColor, client);
  });

  client.onNukeEvent((kind, fromTileId, toTileId, interceptedAt) => {
    renderer.triggerNukeAnim(fromTileId, toTileId, kind === 'intercepted', interceptedAt);
    if (kind === 'intercepted') {
      showStatus('Nükleer füze SAM tarafından düşürüldü!', false);
    } else {
      showStatus('NÜKLEER PATLAMA!', true);
    }
  });

  client.onDisconnect(() => {
    attackTargets.clear();
    exitSpecialMode();
    if (renderer) syncAttackUI(renderer, null);
    if (timerInterval) clearInterval(timerInterval);
    buildPanel.style.display = 'none';
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
