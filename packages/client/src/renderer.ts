import { Application, Graphics, Container } from 'pixi.js';
import { GameState, Tile, TileType, getAdjacentTileIds, canConquer } from '@openfront/core';

const TILE_SIZE = 4; // Very small tiles → map appears large

const TERRAIN_COLORS: Record<TileType, number> = {
  ocean:    0x0b1e30,
  lake:     0x154570,
  plains:   0x255e30,
  highland: 0x5a6828,
  mountain: 0x4e464a,
};

function hexToRgb(hex: number): { r: number; g: number; b: number } {
  return { r: (hex >> 16) & 0xff, g: (hex >> 8) & 0xff, b: hex & 0xff };
}

function blendColors(base: number, overlay: number, t: number): number {
  const b = hexToRgb(base);
  const o = hexToRgb(overlay);
  const r = Math.round(b.r + (o.r - b.r) * t);
  const g = Math.round(b.g + (o.g - b.g) * t);
  const bl = Math.round(b.b + (o.b - b.b) * t);
  return (r << 16) | (g << 8) | bl;
}

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
  private playerId: string | null = null;

  private onTileClickCb: ((tileId: number) => void) | null = null;
  private onTileHoverCb: ((tile: Tile | null) => void) | null = null;

  constructor(app: Application) {
    this.app = app;
    this.mapContainer = new Container();
    this.app.stage.addChild(this.mapContainer);

    this.mapGfx = new Graphics();
    this.mapContainer.addChild(this.mapGfx);

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

  setState(state: GameState, playerId: string): void {
    const isFirst = !this.state;
    this.state = state;
    this.playerId = playerId;

    if (isFirst) {
      // Center camera on player's starting tile
      const pt = state.tiles.find(t => t.owner === playerId);
      if (pt) {
        const sw = this.app.screen.width;
        const sh = this.app.screen.height;
        // Center the whole map initially
        const mapPxW = state.mapWidth * TILE_SIZE;
        const mapPxH = state.mapHeight * TILE_SIZE;
        this.cameraX = (sw - mapPxW) / 2;
        this.cameraY = (sh - mapPxH) / 2;
        this.applyCamera();
      }
    }

    this.updateConquerableTiles();
    this.renderMap();
    this.renderMinimap();
  }

  updateState(state: GameState): void {
    this.state = state;
    this.updateConquerableTiles();
    this.renderMap();
    this.renderMinimap();
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

    const { tiles, players } = this.state;
    const ts = TILE_SIZE;
    const ts1 = ts - 1;

    // ── Pass 1: base fills ──
    for (const tile of tiles) {
      const px = tile.x * ts;
      const py = tile.y * ts;

      let fill = TERRAIN_COLORS[tile.type];
      if (tile.owner) {
        const p = players[tile.owner];
        if (p) fill = blendColors(TERRAIN_COLORS[tile.type], p.color, 0.6);
      }
      if (tile.id === this.hoveredTileId && canConquer(tile)) {
        fill = blendColors(fill, 0xffffff, 0.2);
      }

      g.rect(px, py, ts1, ts1).fill({ color: fill });
    }

    // ── Pass 2: conquerable frontier — green border ──
    for (const tileId of this.conquerableTiles) {
      const tile = tiles[tileId];
      if (!tile) continue;
      const px = tile.x * ts;
      const py = tile.y * ts;
      const isHov = tile.id === this.hoveredTileId;

      if (isHov) {
        const bright = blendColors(TERRAIN_COLORS[tile.type], 0x00ff88, 0.5);
        g.rect(px, py, ts1, ts1).fill({ color: bright });
      }
      g.rect(px, py, ts1, ts1).stroke({ color: 0x44ee66, width: 1 });
    }

    // ── Pass 3: attack target — pulsing red/orange ──
    if (this.attackTargetId !== null) {
      const t = tiles[this.attackTargetId];
      if (t) {
        const px = t.x * ts;
        const py = t.y * ts;
        const bright = blendColors(TERRAIN_COLORS[t.type], 0xff4400, 0.55);
        g.rect(px, py, ts1, ts1).fill({ color: bright });
        g.rect(px, py, ts1, ts1).stroke({ color: 0xff6600, width: 1.5 });
      }
    }
  }

  private renderMinimap(): void {
    if (!this.state) return;
    const { tiles, mapWidth, mapHeight, players } = this.state;

    const mmW = 180;
    const mmH = Math.round(mmW * (mapHeight / mapWidth));
    const mx = this.app.screen.width  - mmW - 12;
    const my = this.app.screen.height - mmH - 12;
    const tW = mmW / mapWidth;
    const tH = mmH / mapHeight;

    const g = this.minimapGfx;
    g.clear();
    g.rect(mx - 1, my - 1, mmW + 2, mmH + 2).fill({ color: 0x050a12 });

    for (const tile of tiles) {
      let color = TERRAIN_COLORS[tile.type];
      if (tile.owner) {
        const p = players[tile.owner];
        if (p) color = blendColors(color, p.color, 0.75);
      }
      g.rect(mx + tile.x * tW, my + tile.y * tH, Math.max(1, tW), Math.max(1, tH)).fill({ color });
    }

    // Viewport rect
    const vx = (-this.cameraX / this.zoom / TILE_SIZE) * tW;
    const vy = (-this.cameraY / this.zoom / TILE_SIZE) * tH;
    const vw = (this.app.screen.width  / this.zoom / TILE_SIZE) * tW;
    const vh = (this.app.screen.height / this.zoom / TILE_SIZE) * tH;
    g.rect(mx + vx, my + vy, vw, vh).stroke({ color: 0xffffff, width: 1 });
  }

  setOnTileClick(cb: (tileId: number) => void): void { this.onTileClickCb = cb; }
  setOnTileHover(cb: (tile: Tile | null) => void): void { this.onTileHoverCb = cb; }
  clearSelection(): void { this.renderMap(); }
}
