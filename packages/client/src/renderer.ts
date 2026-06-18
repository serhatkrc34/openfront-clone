import { Application, Graphics, Container, Text } from 'pixi.js';
import { GameState, Tile, TileType, getAdjacentTileIds, canConquer } from '@openfront/core';

const TILE_SIZE = 4; // Very small tiles → map appears large

const TERRAIN_COLORS: Record<TileType, number> = {
  ocean:    0x0a1e35,
  lake:     0x0d5080,
  plains:   0x1e6832,
  highland: 0x6b7a28,
  mountain: 0x524850,
};

const WATER_TYPES = new Set<TileType>(['ocean', 'lake']);
const LAND_TYPES  = new Set<TileType>(['plains', 'highland', 'mountain']);

// Elevation base values per terrain type (0–100 scale)
const ELEVATION_BASE: Record<TileType, number> = {
  ocean:    20,
  lake:     30,
  plains:   45,
  highland: 65,
  mountain: 80,
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
  const r = Math.round(b.r + (o.r - b.r) * t);
  const g = Math.round(b.g + (o.g - b.g) * t);
  const bl = Math.round(b.b + (o.b - b.b) * t);
  return rgbToHex(r, g, bl);
}

function applyBrightness(color: number, brightness: number): number {
  const { r, g, b } = hexToRgb(color);
  return rgbToHex(
    Math.min(255, Math.round(r * brightness)),
    Math.min(255, Math.round(g * brightness)),
    Math.min(255, Math.round(b * brightness)),
  );
}

function brightenColor(color: number, factor: number): number {
  return applyBrightness(color, factor);
}

// Elevation-based terrain shading: brightness = 0.55 + (elevation/100) * 0.7
function elevationShade(baseColor: number, elevation: number): number {
  const brightness = 0.55 + (elevation / 100) * 0.7;
  return applyBrightness(baseColor, brightness);
}

// Flash entry tracking
interface FlashEntry {
  tileId: number;
  startTime: number;
}

const FLASH_DURATION = 600; // ms

export class Renderer {
  private app: Application;
  private mapContainer: Container;
  private minimapGfx: Graphics;
  private mapGfx: Graphics;

  private cameraX = 0;
  private cameraY = 0;
  private zoom = 1;

  private isDragging = false;
  private hasDragged = false;
  private dragStart = { x: 0, y: 0 };
  private dragCamStart = { x: 0, y: 0 };

  private hoveredTileId: number | null = null;

  // Tiles the current player can conquer (border frontier)
  private conquerableTiles: Set<number> = new Set();
  // The final target tile set by the player
  private attackTargetId: number | null = null;

  private state: GameState | null = null;
  private prevOwners: Map<number, string | null> = new Map();
  private playerId: string | null = null;

  private onTileClickCb: ((tileId: number) => void) | null = null;
  private onTileHoverCb: ((tile: Tile | null) => void) | null = null;

  // Territory text labels
  private labelsContainer: Container;
  private playerLabels: Map<string, Text> = new Map();
  private playerCentroids: Map<string, { cx: number; cy: number }> = new Map();

  // Conquest flash entries
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
      const newZoom = Math.min(8, Math.max(0.3, this.zoom * factor));
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

    canvas.addEventListener('contextmenu', (e: Event) => e.preventDefault());
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
      if (this.flashEntries.length > 0) {
        requestAnimationFrame(tick);
      } else {
        this.animating = false;
      }
    };
    requestAnimationFrame(tick);
  }

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
        const colorHex = '#' + p.color.toString(16).padStart(6, '0');
        label = new Text({
          text: '',
          style: {
            fontFamily: 'Segoe UI, system-ui, sans-serif',
            fontSize: 11,
            fontWeight: '700',
            fill: colorHex,
            stroke: { color: '#000000', width: 3 },
            align: 'center',
            lineHeight: 15,
          },
        });
        label.anchor.set(0.5, 0.5);
        this.labelsContainer.addChild(label);
        this.playerLabels.set(id, label);
      }

      label.text = `${p.name}\n${this.fmtN(p.troops)}`;
      label.x = screenX;
      label.y = screenY;
      label.visible = true;
    }

    for (const [id, label] of this.playerLabels.entries()) {
      if (!seenIds.has(id)) label.visible = false;
    }
  }

  setState(state: GameState, playerId: string): void {
    const isFirst = !this.state;
    this.state = state;
    this.playerId = playerId;
    this.recordOwners(state);

    if (isFirst) {
      const sw = this.app.screen.width;
      const sh = this.app.screen.height;
      const mapPxW = state.mapWidth * TILE_SIZE;
      const mapPxH = state.mapHeight * TILE_SIZE;
      this.cameraX = (sw - mapPxW) / 2;
      this.cameraY = (sh - mapPxH) / 2;
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
    if (this.flashEntries.length > 0) {
      this.startAnimationLoop();
    }
  }

  updatePlayers(players: GameState['players']): void {
    if (!this.state) return;
    this.state = { ...this.state, players };
    this.updateLabelPositions();
  }

  setAttackTargetId(id: number | null): void {
    this.attackTargetId = id;
    this.renderMap();
  }

  clearAttackTarget(): void {
    this.attackTargetId = null;
    this.renderMap();
  }

  private renderMap(): void {
    if (!this.state) return;
    const g = this.mapGfx;
    g.clear();

    const { tiles, players, mapWidth, mapHeight } = this.state;
    const ts = TILE_SIZE;
    const now = performance.now();

    // ── Pass 1: base fills with elevation shading ──
    for (const tile of tiles) {
      const px = tile.x * ts;
      const py = tile.y * ts;

      const elevation = ELEVATION_BASE[tile.type];
      let fill = elevationShade(TERRAIN_COLORS[tile.type], elevation);

      if (tile.owner) {
        const p = players[tile.owner];
        if (p) fill = blendColors(fill, p.color, 0.55);
      }

      // Hover effect: brighter overlay on conquerable frontier tiles
      if (tile.id === this.hoveredTileId && this.conquerableTiles.has(tile.id)) {
        fill = blendColors(fill, 0xffffff, 0.28);
      } else if (tile.id === this.hoveredTileId && canConquer(tile)) {
        fill = blendColors(fill, 0xffffff, 0.15);
      }

      g.rect(px, py, ts, ts);
      g.fill({ color: fill });
    }

    // ── Pass 2: coastline accents ──
    for (const tile of tiles) {
      if (!LAND_TYPES.has(tile.type)) continue;
      const px = tile.x * ts;
      const py = tile.y * ts;

      // Check right neighbor for land→water boundary
      if (tile.x + 1 < mapWidth) {
        const right = tiles[tile.y * mapWidth + (tile.x + 1)];
        if (right && WATER_TYPES.has(right.type)) {
          g.moveTo(px + ts, py).lineTo(px + ts, py + ts);
          g.stroke({ color: 0x88ccff, width: 1, alpha: 0.8 });
        }
      }

      // Check bottom neighbor for land→water boundary
      if (tile.y + 1 < mapHeight) {
        const bottom = tiles[(tile.y + 1) * mapWidth + tile.x];
        if (bottom && WATER_TYPES.has(bottom.type)) {
          g.moveTo(px, py + ts).lineTo(px + ts, py + ts);
          g.stroke({ color: 0x88ccff, width: 1, alpha: 0.8 });
        }
      }
    }

    // ── Pass 3: territory borders (right + bottom edges only, no duplicates) ──
    for (const tile of tiles) {
      if (!tile.owner) continue;
      const px = tile.x * ts;
      const py = tile.y * ts;
      const p = players[tile.owner];
      if (!p) continue;
      // Brighten player color mixed with white 40% for crisp border
      const borderColor = blendColors(p.color, 0xffffff, 0.4);

      // Right neighbor
      if (tile.x + 1 < mapWidth) {
        const right = tiles[tile.y * mapWidth + (tile.x + 1)];
        if (right && right.owner !== tile.owner) {
          g.moveTo(px + ts, py).lineTo(px + ts, py + ts);
          g.stroke({ color: borderColor, width: 1 });
        }
      }

      // Bottom neighbor
      if (tile.y + 1 < mapHeight) {
        const bottom = tiles[(tile.y + 1) * mapWidth + tile.x];
        if (bottom && bottom.owner !== tile.owner) {
          g.moveTo(px, py + ts).lineTo(px + ts, py + ts);
          g.stroke({ color: borderColor, width: 1 });
        }
      }
    }

    // ── Pass 4: conquerable frontier — green border ──
    for (const tileId of this.conquerableTiles) {
      const tile = tiles[tileId];
      if (!tile) continue;
      const px = tile.x * ts;
      const py = tile.y * ts;
      const isHov = tile.id === this.hoveredTileId;

      if (isHov) {
        // Show bright fill + thicker border on hover
        const bright = blendColors(TERRAIN_COLORS[tile.type], 0x00ff88, 0.5);
        g.rect(px, py, ts, ts);
        g.fill({ color: bright });
        g.rect(px, py, ts, ts);
        g.stroke({ color: 0x44ee66, width: 1.5 });
      } else {
        g.rect(px, py, ts, ts);
        g.stroke({ color: 0x44ee66, width: 1 });
      }
    }

    // ── Pass 5: attack target — orange-red fill tint + border ──
    if (this.attackTargetId !== null) {
      const t = tiles[this.attackTargetId];
      if (t) {
        const px = t.x * ts;
        const py = t.y * ts;
        const tintFill = blendColors(TERRAIN_COLORS[t.type], 0xff5500, 0.65);
        g.rect(px, py, ts, ts);
        g.fill({ color: tintFill });
        g.rect(px, py, ts, ts);
        g.stroke({ color: 0xff6600, width: 1.5 });
      }
    }

    // ── Pass 6: conquest flash — white fade ──
    if (this.flashEntries.length > 0) {
      for (const flash of this.flashEntries) {
        const tile = tiles[flash.tileId];
        if (!tile) continue;
        const elapsed = now - flash.startTime;
        const alpha = Math.max(0, 1 - elapsed / FLASH_DURATION);
        const px = tile.x * ts;
        const py = tile.y * ts;
        g.rect(px, py, ts, ts);
        g.fill({ color: 0xffffff, alpha });
      }
    }
  }

  private renderMinimap(): void {
    if (!this.state) return;
    const { tiles, mapWidth, mapHeight, players } = this.state;

    const mmW = 200;
    const mmH = Math.round(mmW * (mapHeight / mapWidth));
    const mx = this.app.screen.width  - mmW - 14;
    const my = this.app.screen.height - mmH - 14;
    const tW = mmW / mapWidth;
    const tH = mmH / mapHeight;

    const g = this.minimapGfx;
    g.clear();

    // Minimap background
    g.rect(mx - 2, my - 2, mmW + 4, mmH + 4);
    g.fill({ color: 0x050a12 });
    // Styled border
    g.rect(mx - 2, my - 2, mmW + 4, mmH + 4);
    g.stroke({ color: 0x284090, width: 1, alpha: 0.7 });

    for (const tile of tiles) {
      let color = TERRAIN_COLORS[tile.type];
      if (tile.owner) {
        const p = players[tile.owner];
        if (p) {
          color = blendColors(color, p.color, 0.75);
          // Current player's own tiles slightly brighter on minimap
          if (tile.owner === this.playerId) {
            color = brightenColor(color, 1.25);
          }
        }
      }
      g.rect(mx + tile.x * tW, my + tile.y * tH, Math.max(1, tW), Math.max(1, tH));
      g.fill({ color });
    }

    // Attack target: red dot on minimap
    if (this.attackTargetId !== null) {
      const at = tiles[this.attackTargetId];
      if (at) {
        const dotX = mx + at.x * tW;
        const dotY = my + at.y * tH;
        const dotR = Math.max(1.5, tW * 1.5);
        g.circle(dotX, dotY, dotR);
        g.fill({ color: 0xff3300 });
      }
    }

    // Viewport rect
    const vx = (-this.cameraX / this.zoom / TILE_SIZE) * tW;
    const vy = (-this.cameraY / this.zoom / TILE_SIZE) * tH;
    const vw = (this.app.screen.width  / this.zoom / TILE_SIZE) * tW;
    const vh = (this.app.screen.height / this.zoom / TILE_SIZE) * tH;
    g.rect(mx + vx, my + vy, vw, vh);
    g.stroke({ color: 0xffffff, width: 1, alpha: 0.8 });
  }

  setOnTileClick(cb: (tileId: number) => void): void { this.onTileClickCb = cb; }
  setOnTileHover(cb: (tile: Tile | null) => void): void { this.onTileHoverCb = cb; }
  clearSelection(): void { this.renderMap(); }
}
