import { Application, Graphics, Container, Text } from 'pixi.js';
import { GameState, Tile, TileType, Building, getAdjacentTileIds, canConquer } from '@openfront/core';

const TILE_SIZE = 2;

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
  city:        0xffcc00,
  port:        0x00aaff,
  sam:         0xff3333,
  silo:        0xaaaaaa,
  factory:     0xdd6600,
  defensePost: 0x44cc44,
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

interface NukeAnim {
  fromX: number; fromY: number;
  toX: number; toY: number;
  startTime: number;
  duration: number;
  intercepted: boolean;
  intX?: number; intY?: number;
}

export class Renderer {
  private app: Application;
  private mapContainer: Container;
  private mapGfx: Graphics;
  private hoverGfx: Graphics;
  private animGfx: Graphics;
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
  private attackTargetIds: Set<number> = new Set();

  private state: GameState | null = null;
  private prevOwners: Map<number, string | null> = new Map();
  private playerId: string | null = null;

  private onTileClickCb: ((tileId: number) => void) | null = null;
  private onTileHoverCb: ((tile: Tile | null) => void) | null = null;
  private onTileRightClickCb: ((tileId: number, x: number, y: number) => void) | null = null;

  private flashEntries: FlashEntry[] = [];
  private animating = false;

  private nukeAnims: NukeAnim[] = [];
  private alwaysAnimating = false;

  constructor(app: Application) {
    this.app = app;

    this.mapContainer = new Container();
    this.app.stage.addChild(this.mapContainer);

    this.mapGfx = new Graphics();
    this.mapContainer.addChild(this.mapGfx);

    this.hoverGfx = new Graphics();
    this.mapContainer.addChild(this.hoverGfx);

    this.animGfx = new Graphics();
    this.mapContainer.addChild(this.animGfx);

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
        this.renderHover();
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
      this.renderHover();
      if (this.flashEntries.length > 0) requestAnimationFrame(tick);
      else this.animating = false;
    };
    requestAnimationFrame(tick);
  }

  // ── Nuke & building animations ────────────────────────────────────────────

  triggerNukeAnim(fromTileId: number, toTileId: number, intercepted: boolean, interceptAtId?: number): void {
    if (!this.state) return;
    const { tiles } = this.state;
    const from = tiles[fromTileId], to = tiles[toTileId];
    if (!from || !to) return;
    const ts = TILE_SIZE;
    const anim: NukeAnim = {
      fromX: from.x * ts + ts / 2, fromY: from.y * ts + ts / 2,
      toX: to.x * ts + ts / 2,   toY: to.y * ts + ts / 2,
      startTime: performance.now(), duration: 2200,
      intercepted,
    };
    if (intercepted && interceptAtId !== undefined) {
      const intTile = tiles[interceptAtId];
      if (intTile) { anim.intX = intTile.x * ts + ts / 2; anim.intY = intTile.y * ts + ts / 2; }
    }
    this.nukeAnims.push(anim);
    this.startAlwaysAnimLoop();
  }

  private startAlwaysAnimLoop(): void {
    if (this.alwaysAnimating) return;
    this.alwaysAnimating = true;
    const loop = () => {
      if (!this.alwaysAnimating) return;
      this.renderAnimations(performance.now());
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  private renderAnimations(now: number): void {
    if (!this.state) return;
    const g = this.animGfx;
    g.clear();
    const { tiles, buildings } = this.state;
    const ts = TILE_SIZE;

    // Building animations
    for (const building of Object.values(buildings)) {
      const tile = tiles[building.tileId];
      if (!tile) continue;
      const cx = tile.x * ts + ts / 2;
      const cy = tile.y * ts + ts / 2;

      switch (building.type) {
        case 'city': {
          const pulse = 0.5 + 0.5 * Math.sin(now / 700);
          g.circle(cx, cy, ts * 1.1 + pulse * ts * 0.5);
          g.fill({ color: 0xffcc00, alpha: 0.08 + pulse * 0.06 });
          break;
        }
        case 'factory': {
          for (let i = 0; i < 3; i++) {
            const t = ((now / 800 + i * 0.333) % 1);
            const puffX = cx + (i - 1) * ts * 0.4;
            const puffY = cy - t * ts * 2;
            g.circle(puffX, puffY, (1 - t) * ts * 0.45);
            g.fill({ color: 0x999999, alpha: (1 - t) * 0.45 });
          }
          break;
        }
        case 'sam': {
          const angle = (now / 1500) % (Math.PI * 2);
          const r = ts * 2.5;
          // Radar sweep
          g.moveTo(cx, cy);
          g.lineTo(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r);
          g.stroke({ color: 0xff3333, width: 0.6, alpha: 0.8 });
          // Range ring
          g.circle(cx, cy, r);
          g.stroke({ color: 0xff3333, width: 0.4, alpha: 0.25 });
          break;
        }
        case 'port': {
          const rippleT = (now / 1200) % 1;
          g.circle(cx, cy, ts + rippleT * ts * 2);
          g.stroke({ color: 0x00aaff, width: 0.5, alpha: (1 - rippleT) * 0.5 });
          break;
        }
        case 'silo': {
          const pulse = 0.5 + 0.5 * Math.sin(now / 500);
          g.circle(cx, cy, ts * 0.6);
          g.stroke({ color: 0xdddddd, width: 0.6, alpha: pulse * 0.6 });
          break;
        }
        case 'defensePost': {
          // Shield hexagon pulse
          const pulse = 0.5 + 0.5 * Math.sin(now / 600);
          const r = ts * 1.6 + pulse * ts * 0.4;
          for (let i = 0; i < 6; i++) {
            const a0 = (i / 6) * Math.PI * 2;
            const a1 = ((i + 1) / 6) * Math.PI * 2;
            if (i === 0) g.moveTo(cx + Math.cos(a0) * r, cy + Math.sin(a0) * r);
            g.lineTo(cx + Math.cos(a1) * r, cy + Math.sin(a1) * r);
          }
          g.stroke({ color: 0x44cc44, width: 0.7, alpha: 0.4 + pulse * 0.3 });
          break;
        }
      }
    }

    // Nuke animations
    const alive: NukeAnim[] = [];
    for (const anim of this.nukeAnims) {
      const elapsed = now - anim.startTime;
      const t = Math.min(1, elapsed / anim.duration);

      if (anim.intercepted && anim.intX !== undefined && anim.intY !== undefined) {
        // Fly to intercept point (halfway through time)
        const intT = 0.5;
        const ft = Math.min(t / intT, 1);
        const acx = anim.fromX + (anim.intX - anim.fromX) * ft;
        const acy = anim.fromY + (anim.intY - anim.fromY) * ft;
        // Missile dot
        g.circle(acx, acy, 1.5);
        g.fill({ color: 0xffffff });
        // Trail
        const tx0 = anim.fromX + (anim.intX - anim.fromX) * Math.max(0, ft - 0.15);
        const ty0 = anim.fromY + (anim.intY - anim.fromY) * Math.max(0, ft - 0.15);
        g.moveTo(tx0, ty0); g.lineTo(acx, acy);
        g.stroke({ color: 0xffffff, width: 1, alpha: 0.6 });

        if (ft >= 1) {
          // Interception explosion
          const et = (t - intT) / (1 - intT);
          const er = et * ts * 4;
          g.circle(anim.intX, anim.intY, er);
          g.fill({ color: 0x44ff44, alpha: (1 - et) * 0.7 });
          g.circle(anim.intX, anim.intY, er * 0.5);
          g.fill({ color: 0xffffff, alpha: (1 - et) * 0.5 });
        }
      } else {
        // Arc trajectory via quadratic bezier control point above midpoint
        const midX = (anim.fromX + anim.toX) / 2;
        const midY = (anim.fromY + anim.toY) / 2 - Math.max(20, Math.hypot(anim.toX - anim.fromX, anim.toY - anim.fromY) * 0.4);
        const bt = t;
        const acx = (1-bt)*(1-bt)*anim.fromX + 2*(1-bt)*bt*midX + bt*bt*anim.toX;
        const acy = (1-bt)*(1-bt)*anim.fromY + 2*(1-bt)*bt*midY + bt*bt*anim.toY;
        // Trail (a few points back)
        const bt2 = Math.max(0, bt - 0.08);
        const tx0 = (1-bt2)*(1-bt2)*anim.fromX + 2*(1-bt2)*bt2*midX + bt2*bt2*anim.toX;
        const ty0 = (1-bt2)*(1-bt2)*anim.fromY + 2*(1-bt2)*bt2*midY + bt2*bt2*anim.toY;
        g.moveTo(tx0, ty0); g.lineTo(acx, acy);
        g.stroke({ color: 0xff8800, width: 1.5, alpha: 0.8 });
        // Warhead
        g.circle(acx, acy, 2.5);
        g.fill({ color: 0xff4400 });
        g.circle(acx, acy, 2.5);
        g.stroke({ color: 0xffcc00, width: 0.8 });

        if (t >= 1) {
          // Impact explosion — expanding rings
          const et = Math.min(1, (elapsed - anim.duration) / 800);
          g.circle(anim.toX, anim.toY, et * ts * 12);
          g.fill({ color: 0xff4400, alpha: (1 - et) * 0.6 });
          g.circle(anim.toX, anim.toY, et * ts * 8);
          g.fill({ color: 0xffcc00, alpha: (1 - et) * 0.8 });
          g.circle(anim.toX, anim.toY, et * ts * 4);
          g.fill({ color: 0xffffff, alpha: (1 - et) * 0.9 });
          if (et >= 1) { continue; } // done
        }
      }

      if (t < 1 || (anim.intercepted ? t < 1 : elapsed < anim.duration + 800)) {
        alive.push(anim);
      }
    }
    this.nukeAnims = alive;

    // Stop loop if nothing needs continuous animation
    if (Object.keys(buildings).length === 0 && this.nukeAnims.length === 0) {
      this.alwaysAnimating = false;
    }
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
      // Auto-fit: scale so the whole map is visible with a small margin
      const scaleX = this.app.screen.width  / mapPxW;
      const scaleY = this.app.screen.height / mapPxH;
      this.zoom = Math.min(scaleX, scaleY) * 0.92;
      this.cameraX = (this.app.screen.width  - mapPxW * this.zoom) / 2;
      this.cameraY = (this.app.screen.height - mapPxH * this.zoom) / 2;
      this.applyCamera();
    }

    this.updateConquerableTiles();
    this.computeCentroids();
    this.renderMap();
    this.renderHover();
    this.updateLabelPositions();
    this.renderMinimap();
    if (Object.keys(state.buildings).length > 0) this.startAlwaysAnimLoop();
  }

  updateState(state: GameState): void {
    this.detectNewConquests(state);
    this.state = state;
    this.recordOwners(state);
    this.updateConquerableTiles();
    this.computeCentroids();
    this.renderMap();
    this.renderHover();
    this.updateLabelPositions();
    this.renderMinimap();
    if (this.flashEntries.length > 0) this.startAnimationLoop();
    if (Object.keys(state.buildings).length > 0) this.startAlwaysAnimLoop();
  }

  updatePlayers(players: GameState['players']): void {
    if (!this.state) return;
    this.state = { ...this.state, players };
    this.updateLabelPositions();
  }

  setAttackTargetIds(ids: number[]): void {
    this.attackTargetIds = new Set(ids);
    this.renderMap();
    this.renderHover();
  }

  clearAttackTargets(): void {
    this.attackTargetIds.clear();
    this.renderMap();
    this.renderHover();
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

    const attackTargetTiles = this.attackTargetIds;

    // ── Pass 1: terrain + territory fills ──
    for (const tile of tiles) {
      let fill = this.baseTileColor(tile, players);
      const px = tile.x * ts;
      const py = tile.y * ts;

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

      if (tile.x + 1 < mapWidth) {
        const right = tiles[tile.y * mapWidth + (tile.x + 1)];
        if (right && right.owner !== tile.owner) {
          g.moveTo(px + ts, py).lineTo(px + ts, py + ts);
          g.stroke({ color: borderColor, width: 1 });
        }
      }
      if (tile.y + 1 < mapHeight) {
        const bottom = tiles[(tile.y + 1) * mapWidth + tile.x];
        if (bottom && bottom.owner !== tile.owner) {
          g.moveTo(px, py + ts).lineTo(px + ts, py + ts);
          g.stroke({ color: borderColor, width: 1 });
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
          g.stroke({ color: 0x4488cc, width: 0.5, alpha: 0.65 });
        }
      }
      if (tile.y + 1 < mapHeight) {
        const b = tiles[(tile.y + 1) * mapWidth + tile.x];
        if (b && WATER_TYPES.has(b.type)) {
          g.moveTo(px, py + ts).lineTo(px + ts, py + ts);
          g.stroke({ color: 0x4488cc, width: 0.5, alpha: 0.65 });
        }
      }
    }

    // ── Pass 4: conquerable frontier (green glow) ──
    for (const tileId of this.conquerableTiles) {
      const tile = tiles[tileId];
      if (!tile) continue;
      const px = tile.x * ts;
      const py = tile.y * ts;
      g.rect(px, py, ts, ts);
      g.stroke({ color: 0x33cc55, width: 0.5, alpha: 0.75 });
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

    // ── Pass 6: attack target tile border ring ──
    for (const tileId of attackTargetTiles) {
      const tile = tiles[tileId];
      if (!tile) continue;
      const px = tile.x * ts;
      const py = tile.y * ts;
      g.rect(px, py, ts, ts);
      g.stroke({ color: 0xff7700, width: 1, alpha: 0.9 });
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
    for (const tileId of this.attackTargetIds) {
      const at = tiles[tileId];
      if (at) {
        g.circle(mx + at.x * tW + tW / 2, my + at.y * tH + tH / 2, Math.max(2, tW * 2));
        g.fill({ color: 0xff4400 });
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

  private renderHover(): void {
    this.hoverGfx.clear();
    if (this.hoveredTileId === null || !this.state) return;
    const tile = this.state.tiles[this.hoveredTileId];
    if (!tile || !canConquer(tile)) return;
    const ts = TILE_SIZE;
    const px = tile.x * ts;
    const py = tile.y * ts;
    if (this.conquerableTiles.has(this.hoveredTileId)) {
      this.hoverGfx.rect(px, py, ts, ts);
      this.hoverGfx.fill({ color: 0x66ff88, alpha: 0.5 });
      this.hoverGfx.rect(px, py, ts, ts);
      this.hoverGfx.stroke({ color: 0x44ff66, width: 1 });
    } else {
      this.hoverGfx.rect(px, py, ts, ts);
      this.hoverGfx.fill({ color: 0xffffff, alpha: 0.2 });
    }
  }

  setOnTileClick(cb: (tileId: number) => void): void { this.onTileClickCb = cb; }
  setOnTileHover(cb: (tile: Tile | null) => void): void { this.onTileHoverCb = cb; }
  setOnTileRightClick(cb: (tileId: number, x: number, y: number) => void): void { this.onTileRightClickCb = cb; }
  clearSelection(): void { this.renderMap(); this.renderHover(); }
}
