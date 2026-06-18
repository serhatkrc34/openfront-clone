import { Application } from 'pixi.js';
import { GameClient } from './gameClient';
import { Renderer } from './renderer';
import { GameState, Tile, getAdjacentTileIds, getConquestCost, canConquer } from '@openfront/core';

// UI elements
const connectingOverlay = document.getElementById('connecting-overlay')!;
const gameoverOverlay = document.getElementById('gameover-overlay')!;
const gameoverTitle = document.getElementById('gameover-title')!;
const gameoverMsg = document.getElementById('gameover-msg')!;
const playerNameEl = document.getElementById('player-name')!;
const statTroops = document.getElementById('stat-troops')!;
const statWorkers = document.getElementById('stat-workers')!;
const statPop = document.getElementById('stat-pop')!;
const statGold = document.getElementById('stat-gold')!;
const statTiles = document.getElementById('stat-tiles')!;
const lbList = document.getElementById('lb-list')!;
const troopSlider = document.getElementById('troop-slider') as HTMLInputElement;
const troopPctLabel = document.getElementById('troop-pct-label')!;
const conquerBtn = document.getElementById('conquer-btn') as HTMLButtonElement;
const statusMsg = document.getElementById('status-msg')!;
const tileTooltip = document.getElementById('tile-tooltip')!;

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
  statTiles.textContent = `${player.tileCount} tiles`;
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
  const owner = tile.owner ? state.players[tile.owner]?.name ?? 'Unknown' : 'Neutral';
  const cost = canConquer(tile) ? getConquestCost(tile) : '—';
  tileTooltip.innerHTML = `
    <b>${tile.type.charAt(0).toUpperCase() + tile.type.slice(1)}</b><br>
    Elev: ${tile.elevation} | Cost: ${cost}<br>
    Owner: ${owner}
  `;
  tileTooltip.style.display = 'block';
}

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

  // Troop slider
  troopSlider.addEventListener('input', () => {
    troopPctLabel.textContent = troopSlider.value + '%';
  });

  // Move tooltip with mouse
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

    if (tile.owner === myPlayerId) {
      // Selecting own tile — just highlight
      showStatus(`Selected your tile (${tile.type})`, false);
      conquerBtn.disabled = true;
      return;
    }

    if (!canConquer(tile)) {
      showStatus('Cannot conquer water tiles');
      return;
    }

    // Check adjacency
    const adjacent = getAdjacentTileIds(tileId, currentState.mapWidth, currentState.mapHeight);
    const ownsAdjacent = adjacent.some(id => currentState!.tiles[id]?.owner === myPlayerId);
    if (!ownsAdjacent) {
      showStatus('Must conquer territory adjacent to yours');
      return;
    }

    const cost = getConquestCost(tile);
    const player = currentState.players[myPlayerId];
    const pct = Number(troopSlider.value) / 100;
    const available = Math.floor(player.troops * pct);

    if (available < cost) {
      showStatus(`Need ${cost} troops, you have ${available} (${troopSlider.value}% of ${fmt(player.troops)})`);
      return;
    }

    // Enable conquer button
    conquerBtn.disabled = false;
    conquerBtn.onclick = () => {
      client.sendConquer(tileId, pct);
      conquerBtn.disabled = true;
      renderer.clearSelection();
    };

    showStatus(`Conquer ${tile.type} for ${cost} troops? Click Conquer.`, false);
  });

  client.onConnect((playerId, state) => {
    myPlayerId = playerId;
    currentState = state;
    connectingOverlay.style.display = 'none';
    renderer.setState(state, playerId);
    updateHUD(state, playerId);
    updateLeaderboard(state);
    showStatus('Connected! Click adjacent tiles to conquer.', false);
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
        gameoverTitle.textContent = 'Victory!';
        gameoverMsg.textContent = 'You conquered 80% of the territory!';
      } else {
        gameoverTitle.textContent = 'Game Over';
        gameoverMsg.textContent = `${winner?.name ?? 'Someone'} won the game.`;
      }
    }

    // Check self elimination
    const me = state.players[myPlayerId];
    if (me?.isEliminated) {
      showStatus('You have been eliminated!');
      conquerBtn.disabled = true;
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
    connectingOverlay.style.display = 'flex';
    connectingOverlay.querySelector('p')!.textContent = 'Disconnected. Reconnecting...';
    // Attempt reconnect after 2s
    setTimeout(() => {
      client.connect(getWsUrl());
    }, 2000);
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
