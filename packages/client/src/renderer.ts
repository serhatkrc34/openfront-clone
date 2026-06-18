import { Application, Graphics, Container } from 'pixi.js';
import { GameState, Tile, TileType, getAdjacentTileIds, canConquer } from '@openfront/core';

const TILE_SIZE = 10;

const TERRAIN_COLORS: Record<TileType, number> = {
  ocean: 0x0d2137,
  lake: 0x1a4a7a,
  plains: 0x2d6e3a,
  highland: 0x6b7a3a,
  mountain: 0x5a5055,
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
  private zoom = 2;

  private isDragging = false;
  private hasDragged = false;
  private dragStart = { x: 0, y: 0 };
  private dragCamStart = { x: 0, y: 0 };

  private hoveredTileId: number | null = null;
  private selectedTileId: number | null = null;

  // Tiles the current player can conquer right now
  private conquerableTiles: Set<number> = new Set();

  private state: GameState | null = null;
  private playerId: string | null = null;

  private onTileClick: ((tileId: number) => void) | null = null;
  private onTileHover: ((tile: Tile | null) => void) | null = null;

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
      const newZoom = Math.min(5, Math.max(0.3, this.zoom * factor));
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
      // Any button starts potential drag
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
        this.onTileHover?.(tile ?? null);
        this.renderMap();
      }
    });

    canvas.addEventListener('mouseup', () => {
      this.isDragging = false;
    });

    canvas.addEventListener('click', (e: MouseEvent) => {
      // Suppress click if it was actually a drag
      if (this.hasDragged) { this.hasDragged = false; return; }
      const tileId = this.screenToTile(e.clientX, e.clientY);
      if (tileId !== null) {
        this.selectedTileId = tileId;
        this.onTileClick?.(tileId);
        this.renderMap();
      }
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

  // Recompute which tiles the current player can conquer
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
    const isFirstRender = !this.state;
    this.state = state;
    this.playerId = playerId;

    if (isFirstRender) {
      const playerTile = state.tiles.find(t => t.owner === playerId);
      if (playerTile) {
        const sw = this.app.screen.width;
        const sh = this.app.screen.height;
        this.cameraX = sw / 2 - playerTile.x * TILE_SIZE * this.zoom;
        this.cameraY = sh / 2 - playerTile.y * TILE_SIZE * this.zoom;
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

  private renderMap(): void {
    if (!this.state) return;
    const g = this.mapGfx;
    g.clear();

    const { tiles, players } = this.state;

    // Pass 1: tile fills
    for (const tile of tiles) {
      const px = tile.x * TILE_SIZE;
      const py = tile.y * TILE_SIZE;
      const isHovered = tile.id === this.hoveredTileId;

      let fillColor = TERRAIN_COLORS[tile.type];

      if (tile.owner) {
        const player = players[tile.owner];
        if (player) fillColor = blendColors(TERRAIN_COLORS[tile.type], player.color, 0.58);
      }

      if (isHovered && canConquer(tile)) {
        fillColor = blendColors(fillColor, 0xffffff, 0.22);
      }

      g.rect(px, py, TILE_SIZE - 1, TILE_SIZE - 1).fill({ color: fillColor });
    }

    // Pass 2: conquerable tile highlights (bright pulsing border)
    for (const tileId of this.conquerableTiles) {
      const tile = tiles[tileId];
      if (!tile) continue;
      const px = tile.x * TILE_SIZE;
      const py = tile.y * TILE_SIZE;
      const isHov = tile.id === this.hoveredTileId;
      const isSel = tile.id === this.selectedTileId;

      if (isSel) {
        // Selected conquerable tile — bright gold fill tint
        const fillColor = blendColors(TERRAIN_COLORS[tile.type], 0xffd700, 0.35);
        g.rect(px, py, TILE_SIZE - 1, TILE_SIZE - 1).fill({ color: fillColor });
        g.rect(px, py, TILE_SIZE - 1, TILE_SIZE - 1).stroke({ color: 0xffd700, width: 2 });
      } else if (isHov) {
        // Hovered conquerable — bright green tint
        const fillColor = blendColors(TERRAIN_COLORS[tile.type], 0x00ff88, 0.45);
        g.rect(px, py, TILE_SIZE - 1, TILE_SIZE - 1).fill({ color: fillColor });
        g.rect(px, py, TILE_SIZE - 1, TILE_SIZE - 1).stroke({ color: 0x00ff88, width: 1.5 });
      } else {
        // Normal conquerable border — subtle green outline
        g.rect(px, py, TILE_SIZE - 1, TILE_SIZE - 1).stroke({ color: 0x44ee66, width: 1 });
      }
    }

    // Pass 3: owned tile borders (subtle)
    for (const tile of tiles) {
      if (!tile.owner || tile.owner !== this.playerId) continue;
      const px = tile.x * TILE_SIZE;
      const py = tile.y * TILE_SIZE;
      const player = players[tile.owner];
      if (player) {
        g.rect(px, py, TILE_SIZE - 1, TILE_SIZE - 1).stroke({ color: player.color, width: 0.5 });
      }
    }

    // Pass 4: selected own tile
    if (this.selectedTileId !== null) {
      const t = tiles[this.selectedTileId];
      if (t && t.owner === this.playerId) {
        g.rect(t.x * TILE_SIZE, t.y * TILE_SIZE, TILE_SIZE - 1, TILE_SIZE - 1)
          .stroke({ color: 0xffffff, width: 1.5 });
      }
    }
  }

  private renderMinimap(): void {
    if (!this.state) return;
    const { tiles, mapWidth, mapHeight, players } = this.state;

    const mmW = 160;
    const mmH = Math.round(mmW * (mapHeight / mapWidth));
    const px2 = this.app.screen.width - mmW - 12;
    const py2 = this.app.screen.height - mmH - 12;
    const tileW = mmW / mapWidth;
    const tileH = mmH / mapHeight;

    const g = this.minimapGfx;
    g.clear();

    g.rect(px2 - 1, py2 - 1, mmW + 2, mmH + 2).fill({ color: 0x050a12 });

    for (const tile of tiles) {
      let color = TERRAIN_COLORS[tile.type];
      if (tile.owner) {
        const player = players[tile.owner];
        if (player) color = blendColors(color, player.color, 0.7);
      }
      g.rect(px2 + tile.x * tileW, py2 + tile.y * tileH, Math.max(1, tileW), Math.max(1, tileH))
        .fill({ color });
    }

    // Viewport rect
    const vx = (-this.cameraX / this.zoom / TILE_SIZE) * tileW;
    const vy = (-this.cameraY / this.zoom / TILE_SIZE) * tileH;
    const vw = (this.app.screen.width / this.zoom / TILE_SIZE) * tileW;
    const vh = (this.app.screen.height / this.zoom / TILE_SIZE) * tileH;
    g.rect(px2 + vx, py2 + vy, vw, vh).stroke({ color: 0xffffff, width: 1 });
  }

  setOnTileClick(cb: (tileId: number) => void): void { this.onTileClick = cb; }
  setOnTileHover(cb: (tile: Tile | null) => void): void { this.onTileHover = cb; }
  getSelectedTileId(): number | null { return this.selectedTileId; }
  clearSelection(): void { this.selectedTileId = null; this.renderMap(); }
}
