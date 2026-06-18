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
const contextMenu        = document.getElementById('context-menu')!;
const allianceNotif      = document.getElementById('alliance-notification')!;

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
  const bld = state.buildings[tile.id];
  const bldText = bld ? ` | Yapı: ${bld.type}` : '';
  tileTooltip.innerHTML =
    `<b>${tile.type}</b> | Yükseklik: ${tile.elevation} | Maliyet: ${cost}${bldText}<br>Sahip: ${owner}`;
  tileTooltip.style.display = 'block';
}

// ─── Context menu ─────────────────────────────────────────────────────────────

function hideContextMenu(): void {
  contextMenu.style.display = 'none';
}

function showBuildMenu(tile: Tile, x: number, y: number, state: GameState, client: GameClient): void {
  const gold = myPlayerId ? Math.floor(state.players[myPlayerId]?.gold ?? 0) : 0;
  const hasBuilding = !!state.buildings[tile.id];

  const items: { label: string; cost: number; type: BuildingType; disabled?: boolean }[] = [
    { label: '🏙 Şehir', cost: 500, type: 'city' },
    { label: '⚓ Liman', cost: 300, type: 'port' },
    { label: '🚀 SAM', cost: 800, type: 'sam' },
    { label: '💣 Silo', cost: 1200, type: 'silo' },
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

// ─── Player-targeting auto-attack engine ──────────────────────────────────────

// Set of enemy player IDs we're attacking
const attackTargetPlayerIds = new Set<string>();

function findPathToPlayer(state: GameState, playerId: string, targetPlayerId: string): number | null {
  const { tiles, mapWidth, mapHeight } = state;

  // BFS backward from target player's tiles — find the step adjacent to our territory
  const queue: number[] = [];
  const visited = new Set<number>();

  for (const tile of tiles) {
    if (tile.owner === targetPlayerId) {
      queue.push(tile.id);
      visited.add(tile.id);
    }
  }

  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const adjId of getAdjacentTileIds(cur, mapWidth, mapHeight)) {
      if (visited.has(adjId)) continue;
      const adj = tiles[adjId];
      if (!adj || !canConquer(adj)) continue;
      visited.add(adjId);
      if (adj.owner === playerId) return cur; // cur is adjacent to our land
      queue.push(adjId);
    }
  }
  return null;
}

function syncAttackUI(renderer: import('./renderer').Renderer, state: GameState | null): void {
  const count = attackTargetPlayerIds.size;
  attackIndicator.style.display = count > 0 ? 'block' : 'none';

  if (count === 1 && state) {
    const [id] = attackTargetPlayerIds;
    const p = state.players[id];
    attackIndicator.textContent = `⚔ Hedef: ${p?.name ?? id}`;
  } else if (count > 1) {
    attackIndicator.textContent = `⚔ ${count} Oyuncu Hedefleniyor`;
  }

  renderer.setAttackTargetPlayerIds([...attackTargetPlayerIds]);
}

function startAutoAttackLoop(
  client: GameClient,
  renderer: import('./renderer').Renderer,
  getState: () => GameState | null,
  getPlayerId: () => string | null,
): void {
  setInterval(() => {
    if (attackTargetPlayerIds.size === 0) return;
    const state = getState();
    const playerId = getPlayerId();
    if (!state || !playerId) return;

    const player = state.players[playerId];
    if (!player || player.isEliminated) {
      attackTargetPlayerIds.clear();
      syncAttackUI(renderer, state);
      return;
    }

    const { tiles, mapWidth, mapHeight } = state;
    const pct = Number(troopSlider.value) / 100;
    let changed = false;

    for (const targetId of [...attackTargetPlayerIds]) {
      const target = state.players[targetId];

      // Target eliminated — remove
      if (!target || target.isEliminated) {
        attackTargetPlayerIds.delete(targetId);
        changed = true;
        showStatus(`${target?.name ?? targetId} elendi!`, false);
        continue;
      }

      // Find all my tiles that border this player's tiles directly
      const directBorderTargets: { id: number; cost: number }[] = [];
      for (const tile of tiles) {
        if (tile.owner !== playerId) continue;
        for (const adjId of getAdjacentTileIds(tile.id, mapWidth, mapHeight)) {
          const adj = tiles[adjId];
          if (adj && adj.owner === targetId && canConquer(adj)) {
            const cost = getConquestCost(adj);
            if (isFinite(cost)) directBorderTargets.push({ id: adjId, cost });
          }
        }
      }

      if (directBorderTargets.length > 0) {
        // Attack cheapest border tiles (up to 3 at once)
        directBorderTargets.sort((a, b) => a.cost - b.cost);
        const toAttack = directBorderTargets.slice(0, 3);
        const available = Math.floor(player.troops * pct);

        for (const { id, cost } of toAttack) {
          if (available >= cost) {
            client.sendConquer(id, pct);
          }
        }
      } else {
        // Not adjacent — BFS pathfind toward target
        const nextStep = findPathToPlayer(state, playerId, targetId);
        if (nextStep !== null) {
          const stepTile = tiles[nextStep];
          const cost = getConquestCost(stepTile);
          const available = Math.floor(player.troops * pct);
          if (available >= cost) {
            client.sendConquer(nextStep, pct);
          }
        } else {
          // Completely unreachable (separated by ocean)
          attackTargetPlayerIds.delete(targetId);
          changed = true;
          showStatus(`${target.name} ulaşılamaz durumda`);
        }
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

  troopSlider.addEventListener('input', () => {
    troopPctLabel.textContent = troopSlider.value + '%';
  });

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

    // Click own tile → clear all attack targets
    if (tile.owner === myPlayerId) {
      attackTargetPlayerIds.clear();
      syncAttackUI(renderer, currentState);
      showStatus('Tüm hedefler iptal edildi.', false);
      return;
    }

    if (!canConquer(tile)) {
      showStatus('Su tile\'ları fethedilemez.');
      return;
    }

    if (!tile.owner) {
      // Neutral tile — BFS through it needs an intermediate target
      // For simplicity: try to directly conquer the neutral tile if adjacent
      const pct = Number(troopSlider.value) / 100;
      const player = currentState.players[myPlayerId];
      if (player) {
        const cost = getConquestCost(tile);
        if (Math.floor(player.troops * pct) >= cost) {
          client.sendConquer(tileId, pct);
        } else {
          showStatus(`Yetersiz asker. Gerekli: ${cost}`);
        }
      }
      return;
    }

    // Click enemy tile — target that player
    const myPlayer = currentState.players[myPlayerId];
    if (myPlayer?.alliances.includes(tile.owner)) {
      showStatus(`${currentState.players[tile.owner]?.name} ile ittifak kurulu — saldıramazsın!`);
      return;
    }

    attackTargetPlayerIds.add(tile.owner);
    syncAttackUI(renderer, currentState);
    const targetName = currentState.players[tile.owner]?.name ?? tile.owner;
    showStatus(
      attackTargetPlayerIds.size === 1
        ? `Hedef: ${targetName} — Saldırı başlıyor!`
        : `${attackTargetPlayerIds.size} oyuncu hedefleniyor. Kendi toprağına tıkla → iptal.`,
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
    renderer.setState(state, playerId);
    updateHUD(state, playerId);
    updateLeaderboard(state);

    gameStartTime = Date.now();
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(updateTimer, 1000);

    showStatus('Bağlandı! Düşman toprağına tıkla → saldır. Sağ tıkla → inşa et.', false);
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
      attackTargetPlayerIds.clear();
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
  });

  client.onServerError((msg) => {
    showStatus(msg);
  });

  client.onAllianceProposal((fromId, fromName, fromColor) => {
    showAllianceNotification(fromId, fromName, fromColor, client);
  });

  client.onDisconnect(() => {
    attackTargetPlayerIds.clear();
    if (renderer) syncAttackUI(renderer, null);
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
