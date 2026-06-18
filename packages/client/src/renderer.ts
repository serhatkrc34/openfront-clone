import { Application, Graphics, Container, Text } from 'pixi.js';
import { GameState, Tile, TileType, Building, getAdjacentTileIds, canConquer } from '@openfront/core';

const TILE_SIZE = 4;

const TERRAIN_COLORS: Record<TileType, number> = {
  ocean:    0x0c1e3c,
  lake:     0x0c3870,
  plains:   0x246428,
  highland: 0x606820,
  mountain: 0x605048,
};

const WATER_TYPES = new Set<TileType>(['ocean', 'lake']);
const LAND_TYPES  = new Set<TileType>(['plains', 'highland', 'mountain']);

const ELEVATION_BASE: Record<TileType, number> = {
  ocean:    20,
  lake:     30,
  plains:   45,
  highland: 65,
  mountain: 80,
};

const BUILDING_COLORS: Record<Building['type'], number> = {
  city:  0xffcc00,
  port:  0x00aaff,
  sam:   0xff3333,
  silo:  0xaaaaaa,
};

function hexToRgb(hex: number): { r: number; g: number; b: number } {
  return { r: (hex >> 16) & 0xff, g: (hex >> 8) & 0xff, b: hex & 0xff };
}

function rgbToHex(r: number, g: number, b: number): number {
  return (r << 16) | (g << 8) | b;
}

function blendColors(base: number, overlay: number, t: number): number {
  const b = hexToRgb(base);
  const o = hexToRgb(overlay);
  return rgbToHex(
    Math.round(b.r + (o.r - b.r) * t),
    Math.round(b.g + (o.g - b.g) * t),
    Math.round(b.b + (o.b - b.b) * t),
  );
}

function applyBrightness(color: number, brightness: number): number {
  const { r, g, b } = hexToRgb(color);
  return rgbToHex(
    Math.min(255, Math.round(r * brightness)),
    Math.min(255, Math.round(g * brightness)),
    Math.min(255, Math.round(b * brightness)),
  );
}

function tileNoise(id: number): number {
  return ((id * 7919 + 13337) % 256) / 256;
}

interface FlashEntry { tileId: number; startTime: number; }
const FLASH_DURATION = 500;

export class Renderer {
  private app: Application;
  private mapContainer: Container;
  private mapGfx: Graphics;
  private minimapGfx: Graphics;
  private labelsContainer: Container;

  private playerLabels: Map<string, Text> = new Map();
  private playerCentroids: Map<string, { cx: number; cy: number }> = new Map();

  private cameraX = 0;
  private cameraY = 0;
  private zoom = 1;

  private isDragging = false;
  private hasDragged = false;
  private dragStart = { x: 0, y: 0 };
  private dragCamStart = { x: 0, y: 0 };

  private hoveredTileId: number | null = null;
  private conquerableTiles: Set<number> = new Set();
  private attackTargetPlayerIds: Set<string> = new Set();

  private state: GameState | null = null;
  private prevOwners: Map<number, string | null> = new Map();
  private playerId: string | null = null;

  private onTileClickCb: ((tileId: number) => void) | null = null;
  private onTileHoverCb: ((tile: Tile | null) => void) | null = null;
  private onTileRightClickCb: ((tileId: number, x: number, y: number) => void) | null = null;

  private flashEntries: FlashEntry[] = [];
  private animating = false;

  constructor(app: Application) {
    this.app = app;

    this.mapContainer = new Container();
    this.app.stage.addChild(this.mapContainer);

    this.mapGfx = new Graphics();
    this.mapContainer.addChild(this.mapGfx);

    this.labelsContainer = new Container();
    this.labelsContainer.zIndex = 5;
    this.app.stage.addChild(this.labelsContainer);

    this.minimapGfx = new Graphics();
    this.minimapGfx.zIndex = 10;
    this.app.stage.addChild(this.minimapGfx);
    this.app.stage.sortableChildren = true;

    this.setupInput();
  }

  private setupInput(): void {
    const canvas = this.app.canvas;

    canvas.addEventListener('wheel', (e: WheelEvent) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.12 : 0.9;
      const newZoom = Math.min(10, Math.max(0.3, this.zoom * factor));
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      this.cameraX = mx - (mx - this.cameraX) * (newZoom / this.zoom);
      this.cameraY = my - (my - this.cameraY) * (newZoom / this.zoom);
      this.zoom = newZoom;
      this.applyCamera();
      this.updateLabelPositions();
      this.renderMinimap();
    }, { passive: false });

    canvas.addEventListener('mousedown', (e: MouseEvent) => {
      this.isDragging = true;
      this.hasDragged = false;
      this.dragStart = { x: e.clientX, y: e.clientY };
      this.dragCamStart = { x: this.cameraX, y: this.cameraY };
      if (e.button === 1 || e.button === 2) e.preventDefault();
    });

    canvas.addEventListener('mousemove', (e: MouseEvent) => {
      if (this.isDragging) {
        const dx = e.clientX - this.dragStart.x;
        const dy = e.clientY - this.dragStart.y;
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
          this.hasDragged = true;
          this.cameraX = this.dragCamStart.x + dx;
          this.cameraY = this.dragCamStart.y + dy;
          this.applyCamera();
          this.updateLabelPositions();
          this.renderMinimap();
        }
      }
      const tileId = this.screenToTile(e.clientX, e.clientY);
      if (tileId !== this.hoveredTileId) {
        this.hoveredTileId = tileId;
        const tile = tileId !== null && this.state ? this.state.tiles[tileId] : null;
        this.onTileHoverCb?.(tile ?? null);
        this.renderMap();
      }
    });

    canvas.addEventListener('mouseup', () => { this.isDragging = false; });

    canvas.addEventListener('click', (e: MouseEvent) => {
      if (this.hasDragged) { this.hasDragged = false; return; }
      const tileId = this.screenToTile(e.clientX, e.clientY);
      if (tileId !== null) this.onTileClickCb?.(tileId);
    });

    canvas.addEventListener('contextmenu', (e: MouseEvent) => {
      e.preventDefault();
      if (this.hasDragged) return;
      const tileId = this.screenToTile(e.clientX, e.clientY);
      if (tileId !== null) this.onTileRightClickCb?.(tileId, e.clientX, e.clientY);
    });
  }

  private screenToTile(screenX: number, screenY: number): number | null {
    if (!this.state) return null;
    const rect = this.app.canvas.getBoundingClientRect();
    const localX = (screenX - rect.left - this.cameraX) / this.zoom;
    const localY = (screenY - rect.top - this.cameraY) / this.zoom;
    const tx = Math.floor(localX / TILE_SIZE);
    const ty = Math.floor(localY / TILE_SIZE);
    if (tx < 0 || ty < 0 || tx >= this.state.mapWidth || ty >= this.state.mapHeight) return null;
    return ty * this.state.mapWidth + tx;
  }

  private applyCamera(): void {
    this.mapContainer.x = this.cameraX;
    this.mapContainer.y = this.cameraY;
    this.mapContainer.scale.set(this.zoom);
  }

  private updateConquerableTiles(): void {
    this.conquerableTiles.clear();
    if (!this.state || !this.playerId) return;
    const { tiles, mapWidth, mapHeight } = this.state;
    for (const tile of tiles) {
      if (tile.owner !== this.playerId) continue;
      for (const adjId of getAdjacentTileIds(tile.id, mapWidth, mapHeight)) {
        const adj = tiles[adjId];
        if (adj && canConquer(adj) && adj.owner !== this.playerId) {
          this.conquerableTiles.add(adjId);
        }
      }
    }
  }

  private detectNewConquests(newState: GameState): void {
    if (!this.state) return;
    const now = performance.now();
    for (const tile of newState.tiles) {
      const prevOwner = this.prevOwners.get(tile.id) ?? null;
      const newOwner = tile.owner ?? null;
      if (newOwner !== prevOwner && newOwner !== null) {
        this.flashEntries.push({ tileId: tile.id, startTime: now });
      }
    }
  }

  private recordOwners(state: GameState): void {
    this.prevOwners.clear();
    for (const tile of state.tiles) {
      this.prevOwners.set(tile.id, tile.owner ?? null);
    }
  }

  private startAnimationLoop(): void {
    if (this.animating) return;
    this.animating = true;
    const tick = () => {
      const now = performance.now();
      this.flashEntries = this.flashEntries.filter(f => now - f.startTime < FLASH_DURATION);
      this.renderMap();
      if (this.flashEntries.length > 0) requestAnimationFrame(tick);
      else this.animating = false;
    };
    requestAnimationFrame(tick);
  }

  // ── Labels ────────────────────────────────────────────────────────────────

  private fmtN(n: number): string {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
    if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
    return Math.floor(n).toString();
  }

  private computeCentroids(): void {
    this.playerCentroids.clear();
    if (!this.state) return;
    const sums = new Map<string, { sx: number; sy: number; count: number }>();
    for (const tile of this.state.tiles) {
      if (!tile.owner) continue;
      const e = sums.get(tile.owner) ?? { sx: 0, sy: 0, count: 0 };
      e.sx += tile.x + 0.5;
      e.sy += tile.y + 0.5;
      e.count++;
      sums.set(tile.owner, e);
    }
    for (const [id, s] of sums) {
      this.playerCentroids.set(id, { cx: s.sx / s.count, cy: s.sy / s.count });
    }
  }

  private updateLabelPositions(): void {
    if (!this.state) return;
    const { players } = this.state;
    const seenIds = new Set<string>();

    for (const [id, p] of Object.entries(players)) {
      if (p.isEliminated) continue;
      const centroid = this.playerCentroids.get(id);
      if (!centroid || p.tileCount < 3) continue;
      seenIds.add(id);

      const screenX = centroid.cx * TILE_SIZE * this.zoom + this.cameraX;
      const screenY = centroid.cy * TILE_SIZE * this.zoom + this.cameraY;

      let label = this.playerLabels.get(id);
      if (!label) {
        label = new Text({
          text: '',
          style: {
            fontFamily: 'Segoe UI, system-ui, sans-serif',
            fontSize: 12,
            fontWeight: '700',
            fill: '#' + p.color.toString(16).padStart(6, '0'),
            stroke: { color: '#000000', width: 3 },
            align: 'center',
            lineHeight: 16,
          },
        });
        label.anchor.set(0.5, 0.5);
        this.labelsContainer.addChild(label);
        this.playerLabels.set(id, label);
      }

      // Show alliance indicator on label
      const myId = this.playerId;
      const isAllied = myId && p.alliances?.includes(myId);
      label.text = `${p.name}${isAllied ? ' 🤝' : ''}\n${this.fmtN(p.troops)}`;
      label.x = screenX;
      label.y = screenY;
      label.visible = true;
    }

    for (const [id, label] of this.playerLabels.entries()) {
      if (!seenIds.has(id)) label.visible = false;
    }
  }

  // ── Public state methods ──────────────────────────────────────────────────

  setState(state: GameState, playerId: string): void {
    const isFirst = !this.state;
    this.state = state;
    this.playerId = playerId;
    this.recordOwners(state);

    if (isFirst) {
      const mapPxW = state.mapWidth * TILE_SIZE;
      const mapPxH = state.mapHeight * TILE_SIZE;
      this.cameraX = (this.app.screen.width  - mapPxW) / 2;
      this.cameraY = (this.app.screen.height - mapPxH) / 2;
      this.applyCamera();
    }

    this.updateConquerableTiles();
    this.computeCentroids();
    this.renderMap();
    this.updateLabelPositions();
    this.renderMinimap();
  }

  updateState(state: GameState): void {
    this.detectNewConquests(state);
    this.state = state;
    this.recordOwners(state);
    this.updateConquerableTiles();
    this.computeCentroids();
    this.renderMap();
    this.updateLabelPositions();
    this.renderMinimap();
    if (this.flashEntries.length > 0) this.startAnimationLoop();
  }

  updatePlayers(players: GameState['players']): void {
    if (!this.state) return;
    this.state = { ...this.state, players };
    this.updateLabelPositions();
  }

  setAttackTargetPlayerIds(ids: string[]): void {
    this.attackTargetPlayerIds = new Set(ids);
    this.renderMap();
  }

  clearAttackTargets(): void {
    this.attackTargetPlayerIds.clear();
    this.renderMap();
  }

  // ── Core tile color logic ─────────────────────────────────────────────────

  private baseTileColor(tile: Tile, players: GameState['players']): number {
    const base = TERRAIN_COLORS[tile.type];
    const elev = ELEVATION_BASE[tile.type];
    const noise = tileNoise(tile.id);

    if (tile.owner && players[tile.owner]) {
      const p = players[tile.owner];
      const elevFactor = 0.70 + (elev / 100) * 0.48;
      const noiseF = 0.96 + noise * 0.08;
      let c = applyBrightness(p.color, elevFactor * noiseF);
      c = blendColors(c, base, 0.07);
      return c;
    }

    if (WATER_TYPES.has(tile.type)) {
      const bright = 0.55 + (elev / 100) * 0.55;
      const noiseF = 0.95 + noise * 0.10;
      return applyBrightness(base, bright * noiseF);
    }

    const bright = (0.50 + (elev / 100) * 0.30) * 0.55;
    const noiseF = 0.90 + noise * 0.20;
    return applyBrightness(base, bright * noiseF);
  }

  // ── Rendering ─────────────────────────────────────────────────────────────

  private renderMap(): void {
    if (!this.state) return;
    const g = this.mapGfx;
    g.clear();

    const { tiles, players, mapWidth, mapHeight, buildings } = this.state;
    const ts = TILE_SIZE;
    const now = performance.now();
    const myId = this.playerId;

    // Build set of all tiles owned by attack target players
    const attackTargetTiles = new Set<number>();
    if (this.attackTargetPlayerIds.size > 0) {
      for (const tile of tiles) {
        if (tile.owner && this.attackTargetPlayerIds.has(tile.owner)) {
          attackTargetTiles.add(tile.id);
        }
      }
    }

    // ── Pass 1: terrain + territory fills ──
    for (const tile of tiles) {
      let fill = this.baseTileColor(tile, players);
      const px = tile.x * ts;
      const py = tile.y * ts;

      if (tile.id === this.hoveredTileId) {
        if (this.conquerableTiles.has(tile.id)) {
          fill = blendColors(fill, 0x66ff88, 0.5);
        } else if (canConquer(tile)) {
          fill = blendColors(fill, 0xffffff, 0.20);
        }
      }

      g.rect(px, py, ts, ts);
      g.fill({ color: fill });
    }

    // ── Pass 2: territory borders ──
    for (const tile of tiles) {
      if (!tile.owner) continue;
      const p = players[tile.owner];
      if (!p) continue;
      const px = tile.x * ts;
      const py = tile.y * ts;

      // Allied tiles get teal border, otherwise bright player color border
      const isAllied = myId && p.alliances?.includes(myId);
      const borderColor = isAllied ? 0x44ffcc : blendColors(p.color, 0xffffff, 0.6);
      const borderWidth = isAllied ? 1.5 : 1.5;

      if (tile.x + 1 < mapWidth) {
        const right = tiles[tile.y * mapWidth + (tile.x + 1)];
        if (right && right.owner !== tile.owner) {
          g.moveTo(px + ts, py).lineTo(px + ts, py + ts);
          g.stroke({ color: borderColor, width: borderWidth });
        }
      }
      if (tile.y + 1 < mapHeight) {
        const bottom = tiles[(tile.y + 1) * mapWidth + tile.x];
        if (bottom && bottom.owner !== tile.owner) {
          g.moveTo(px, py + ts).lineTo(px + ts, py + ts);
          g.stroke({ color: borderColor, width: borderWidth });
        }
      }
    }

    // ── Pass 3: coastline accent ──
    for (const tile of tiles) {
      if (!LAND_TYPES.has(tile.type)) continue;
      const px = tile.x * ts;
      const py = tile.y * ts;
      if (tile.x + 1 < mapWidth) {
        const r = tiles[tile.y * mapWidth + (tile.x + 1)];
        if (r && WATER_TYPES.has(r.type)) {
          g.moveTo(px + ts, py).lineTo(px + ts, py + ts);
          g.stroke({ color: 0x4488cc, width: 1, alpha: 0.65 });
        }
      }
      if (tile.y + 1 < mapHeight) {
        const b = tiles[(tile.y + 1) * mapWidth + tile.x];
        if (b && WATER_TYPES.has(b.type)) {
          g.moveTo(px, py + ts).lineTo(px + ts, py + ts);
          g.stroke({ color: 0x4488cc, width: 1, alpha: 0.65 });
        }
      }
    }

    // ── Pass 4: conquerable frontier (green glow) ──
    for (const tileId of this.conquerableTiles) {
      const tile = tiles[tileId];
      if (!tile) continue;
      const px = tile.x * ts;
      const py = tile.y * ts;
      const isHov = tile.id === this.hoveredTileId;
      g.rect(px, py, ts, ts);
      g.stroke({ color: isHov ? 0x44ff66 : 0x33cc55, width: isHov ? 1.5 : 1, alpha: isHov ? 1 : 0.75 });
    }

    // ── Pass 5: attack target territories (orange overlay on enemy tiles) ──
    for (const tileId of attackTargetTiles) {
      const t = tiles[tileId];
      if (!t) continue;
      const px = t.x * ts;
      const py = t.y * ts;
      g.rect(px, py, ts, ts);
      g.fill({ color: 0xff4400, alpha: 0.35 });
    }

    // ── Pass 6: attack target border highlight ──
    for (const tileId of attackTargetTiles) {
      const tile = tiles[tileId];
      if (!tile) continue;
      const px = tile.x * ts;
      const py = tile.y * ts;
      // Only draw border on edges that face OUR territory
      const adjIds = [[tile.x + 1, tile.y], [tile.x - 1, tile.y], [tile.x, tile.y + 1], [tile.x, tile.y - 1]];
      for (const [nx, ny] of adjIds) {
        if (nx < 0 || ny < 0 || nx >= mapWidth || ny >= mapHeight) continue;
        const adj = tiles[ny * mapWidth + nx];
        if (adj?.owner === myId) {
          // Draw border on this edge
          if (nx > tile.x) { g.moveTo(px + ts, py); g.lineTo(px + ts, py + ts); }
          else if (nx < tile.x) { g.moveTo(px, py); g.lineTo(px, py + ts); }
          else if (ny > tile.y) { g.moveTo(px, py + ts); g.lineTo(px + ts, py + ts); }
          else { g.moveTo(px, py); g.lineTo(px + ts, py); }
          g.stroke({ color: 0xff7700, width: 1.5, alpha: 0.9 });
        }
      }
    }

    // ── Pass 7: buildings ──
    for (const building of Object.values(buildings)) {
      const tile = tiles[building.tileId];
      if (!tile) continue;
      const cx = tile.x * ts + ts / 2;
      const cy = tile.y * ts + ts / 2;
      const r = ts * 0.38;
      const color = BUILDING_COLORS[building.type];

      g.circle(cx, cy, r);
      g.fill({ color });
      g.circle(cx, cy, r);
      g.stroke({ color: 0xffffff, width: 0.6, alpha: 0.9 });
    }

    // ── Pass 8: conquest flash ──
    for (const flash of this.flashEntries) {
      const tile = tiles[flash.tileId];
      if (!tile) continue;
      const alpha = Math.max(0, 1 - (now - flash.startTime) / FLASH_DURATION) * 0.65;
      g.rect(tile.x * ts, tile.y * ts, ts, ts);
      g.fill({ color: 0xffffff, alpha });
    }
  }

  private renderMinimap(): void {
    if (!this.state) return;
    const { tiles, mapWidth, mapHeight, players, buildings } = this.state;

    const mmW = 180;
    const mmH = Math.round(mmW * (mapHeight / mapWidth));
    const mx = this.app.screen.width  - mmW - 12;
    const my = this.app.screen.height - mmH - 12;
    const tW = mmW / mapWidth;
    const tH = mmH / mapHeight;

    const g = this.minimapGfx;
    g.clear();

    g.rect(mx - 2, my - 2, mmW + 4, mmH + 4);
    g.fill({ color: 0x040810 });
    g.rect(mx - 2, my - 2, mmW + 4, mmH + 4);
    g.stroke({ color: 0x1e3870, width: 1 });

    for (const tile of tiles) {
      let color: number;
      if (tile.owner && players[tile.owner]) {
        const p = players[tile.owner];
        color = tile.owner === this.playerId
          ? applyBrightness(p.color, 1.25)
          : applyBrightness(p.color, 0.85);
      } else if (WATER_TYPES.has(tile.type)) {
        color = applyBrightness(TERRAIN_COLORS[tile.type], 0.8);
      } else {
        color = applyBrightness(TERRAIN_COLORS[tile.type], 0.30);
      }
      g.rect(mx + tile.x * tW, my + tile.y * tH, Math.max(1, tW), Math.max(1, tH));
      g.fill({ color });
    }

    // Attack target dots on minimap
    for (const tile of tiles) {
      if (tile.owner && this.attackTargetPlayerIds.has(tile.owner)) {
        g.rect(mx + tile.x * tW, my + tile.y * tH, Math.max(1, tW), Math.max(1, tH));
        g.fill({ color: 0xff4400, alpha: 0.6 });
      }
    }

    // Building dots on minimap
    for (const building of Object.values(buildings)) {
      const tile = tiles[building.tileId];
      if (tile) {
        g.circle(mx + tile.x * tW + tW / 2, my + tile.y * tH + tH / 2, Math.max(1.5, tW));
        g.fill({ color: BUILDING_COLORS[building.type] });
      }
    }

    // Viewport rect
    const vx = (-this.cameraX / this.zoom / TILE_SIZE) * tW;
    const vy = (-this.cameraY / this.zoom / TILE_SIZE) * tH;
    const vw = (this.app.screen.width  / this.zoom / TILE_SIZE) * tW;
    const vh = (this.app.screen.height / this.zoom / TILE_SIZE) * tH;
    g.rect(mx + vx, my + vy, vw, vh);
    g.stroke({ color: 0xffffff, width: 1, alpha: 0.6 });
  }

  setOnTileClick(cb: (tileId: number) => void): void { this.onTileClickCb = cb; }
  setOnTileHover(cb: (tile: Tile | null) => void): void { this.onTileHoverCb = cb; }
  setOnTileRightClick(cb: (tileId: number, x: number, y: number) => void): void { this.onTileRightClickCb = cb; }
  clearSelection(): void { this.renderMap(); }
}
