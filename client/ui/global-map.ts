import { WorldGenerator } from '../world/generator.js';
import type { SpawnedShip } from '../objects/ship.js';
import { getTerrainColorRGB } from '../world/terrain-color.js';
// ----------------------------------------------------------------

export class GlobalMap {
  private overlay: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private closeBtn: HTMLElement;

  private terrainCanvas: HTMLCanvasElement | null = null;
  private bakedWorldSize = 0;

  private _visible = false;

  // ── Pan state ────────────────────────────────────────────────────
  private _panX = 0;   // canvas pixels
  private _panY = 0;
  private _dragging = false;
  private _dragStartX = 0;
  private _dragStartY = 0;
  private _panStartX  = 0;
  private _panStartY  = 0;

  // ── Last draw args (needed to redraw on drag without game loop) ──
  private _lastDrawArgs: Parameters<GlobalMap['draw']> | null = null;

  constructor() {
    this.overlay  = document.getElementById('global-map-overlay')!;
    this.canvas   = document.getElementById('global-map-canvas') as HTMLCanvasElement;
    this.ctx      = this.canvas.getContext('2d')!;
    this.closeBtn = document.getElementById('global-map-close')!;

    this.closeBtn.addEventListener('click', () => this.hide());

    // Close on overlay background click (not panel)
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.hide();
    });

    // Recenter button
    const recenterBtn = document.getElementById('global-map-recenter');
    if (recenterBtn) {
      recenterBtn.addEventListener('click', () => {
        this._panX = 0;
        this._panY = 0;
        if (this._lastDrawArgs) this.draw(...this._lastDrawArgs);
      });
    }

    this._initDrag();
  }

  // ── Drag / pan ───────────────────────────────────────────────────

  private _initDrag(): void {
    const el = this.canvas;

    el.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      this._dragging    = true;
      this._dragStartX  = e.clientX;
      this._dragStartY  = e.clientY;
      this._panStartX   = this._panX;
      this._panStartY   = this._panY;
      el.style.cursor   = 'grabbing';
      e.preventDefault();
    });

    window.addEventListener('mousemove', (e) => {
      if (!this._dragging) return;
      const dx = e.clientX - this._dragStartX;
      const dy = e.clientY - this._dragStartY;
      this._panX = this._panStartX + dx;
      this._panY = this._panStartY + dy;
      // Redraw immediately for smooth feel
      if (this._lastDrawArgs) this.draw(...this._lastDrawArgs);
    });

    window.addEventListener('mouseup', () => {
      if (!this._dragging) return;
      this._dragging  = false;
      el.style.cursor = 'grab';
    });

    // Touch support
    el.addEventListener('touchstart', (e) => {
      const t = e.touches[0];
      this._dragging   = true;
      this._dragStartX = t.clientX;
      this._dragStartY = t.clientY;
      this._panStartX  = this._panX;
      this._panStartY  = this._panY;
      e.preventDefault();
    }, { passive: false });

    window.addEventListener('touchmove', (e) => {
      if (!this._dragging) return;
      const t  = e.touches[0];
      const dx = t.clientX - this._dragStartX;
      const dy = t.clientY - this._dragStartY;
      this._panX = this._panStartX + dx;
      this._panY = this._panStartY + dy;
      if (this._lastDrawArgs) this.draw(...this._lastDrawArgs);
    });

    window.addEventListener('touchend', () => { this._dragging = false; });

    el.style.cursor = 'grab';
  }

  // ── Public API ───────────────────────────────────────────────────

  get isVisible(): boolean { return this._visible; }

  show(): void {
    this._visible = true;
    this.overlay.classList.remove('hidden');
  }

  hide(): void {
    this._visible = false;
    this.overlay.classList.add('hidden');
  }

  toggle(): void {
    this._visible ? this.hide() : this.show();
  }

  /** Reset pan to centre. Call when opening so map always opens centred. */
  resetPan(): void {
    this._panX = 0;
    this._panY = 0;
  }

  /** Pre-bake the full world terrain. Call after WorldGenerator.generate(). */
  bakeTexture(gen: WorldGenerator): void {
    const worldSize  = gen.config.worldSize;
    const maxH       = gen.config.maxTerrainHeight;
    const resolution = 512;

    const off    = document.createElement('canvas');
    off.width    = resolution;
    off.height   = resolution;
    const offCtx = off.getContext('2d')!;
    const img    = offCtx.createImageData(resolution, resolution);
    const data   = img.data;

    const islands = gen.getIslands();
    const half    = worldSize / 2;
    const step    = worldSize / resolution;

    for (let row = 0; row < resolution; row++) {
      for (let col = 0; col < resolution; col++) {
        const wx = -half + col * step + step * 0.5;
        const wz = -half + row * step + step * 0.5;

        const h = gen.getHeightAt(wx, wz);

        let closestIsland: typeof islands[0] | null = null;
        let minDist = Infinity;
        for (const isl of islands) {
          const d = Math.hypot(wx - isl.x, wz - isl.z);
          if (d < minDist) { minDist = d; closestIsland = isl; }
        }

        const normalizedH = Math.max(0, h) / maxH;
        const [r, g, b] = getTerrainColorRGB({
          height: h,
          normalizedHeight: normalizedH,
          islandType: closestIsland?.type,
          waterHeight: gen.config.waterHeight,
          oceanDepth: gen.config.oceanDepth,
        });
        const idx         = (row * resolution + col) * 4;
        data[idx]     = r;
        data[idx + 1] = g;
        data[idx + 2] = b;
        data[idx + 3] = 255;
      }
    }

    offCtx.putImageData(img, 0, 0);
    this.terrainCanvas  = off;
    this.bakedWorldSize = worldSize;
    this.resetPan();
  }

  /**
   * Redraw the global map. Call each frame while visible.
   */
  draw(
    playerWorldX: number,
    playerWorldZ: number,
    playerYaw: number,
    ships: SpawnedShip[],
    drivenShip: SpawnedShip | null,
    remotePlayers: Array<{ position: { x: number; z: number }; color: number; name: string }>,
  ): void {
    // Cache args so drag redraws can replay without game-loop data
    this._lastDrawArgs = [playerWorldX, playerWorldZ, playerYaw, ships, drivenShip, remotePlayers];

    const size = this.canvas.width;
    const ctx  = this.ctx;

    ctx.clearRect(0, 0, size, size);

    // ── Background ──────────────────────────────────────────────────
    ctx.fillStyle = '#071520';
    ctx.fillRect(0, 0, size, size);

    // ── All panned content inside a translated save/restore ─────────
    ctx.save();
    ctx.translate(this._panX, this._panY);

    // Terrain
    if (this.terrainCanvas) {
      ctx.drawImage(this.terrainCanvas, 0, 0, size, size);
    }

    // Grid lines
    ctx.save();
    ctx.strokeStyle = 'rgba(79,195,247,0.07)';
    ctx.lineWidth   = 1;
    const gridLines = 8;
    const gridStep  = size / gridLines;
    // Draw grid large enough to cover when panned
    for (let i = -1; i <= gridLines + 1; i++) {
      ctx.beginPath(); ctx.moveTo(i * gridStep, -size); ctx.lineTo(i * gridStep, size * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-size, i * gridStep); ctx.lineTo(size * 2, i * gridStep); ctx.stroke();
    }
    ctx.restore();

    // World-to-canvas helper (includes pan via the saved translate)
    const worldSize = this.bakedWorldSize || 400;
    const worldToCanvas = (wx: number, wz: number): [number, number] => {
      const cx = ((wx + worldSize / 2) / worldSize) * size;
      const cy = ((wz + worldSize / 2) / worldSize) * size;
      return [cx, cy];
    };

    // Ships
    for (const ship of ships) {
      const [sx, sy] = worldToCanvas(ship.body.position.x, ship.body.position.z);
      this._drawShip(ctx, sx, sy, ship.body.rotation.y, ship === drivenShip);
    }

    // Remote players
    for (const rp of remotePlayers) {
      const [rx, ry] = worldToCanvas(rp.position.x, rp.position.z);
      const hex = '#' + rp.color.toString(16).padStart(6, '0');
      ctx.save();
      ctx.beginPath();
      ctx.arc(rx, ry, 6, 0, Math.PI * 2);
      ctx.fillStyle = hex;
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.font = 'bold 10px Courier New, monospace';
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.shadowColor = '#000';
      ctx.shadowBlur  = 4;
      ctx.fillText(rp.name, rx, ry - 8);
      ctx.restore();
    }

    // Local player
    const [px, py] = worldToCanvas(playerWorldX, playerWorldZ);
    this._drawPlayerArrow(ctx, px, py, playerYaw);

    ctx.restore(); // end pan translate

    // ── Fixed UI (not panned) ───────────────────────────────────────

    // Subtle vignette over edges to hint at pannable content
    const vig = ctx.createRadialGradient(size / 2, size / 2, size * 0.35, size / 2, size / 2, size * 0.72);
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, 'rgba(0,0,0,0.45)');
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, size, size);

    // Compass rose — top-right, fixed
    this._drawCompassRose(ctx, size - 44, 44, 32);

    // Scale bar — bottom-left, fixed
    this._drawScaleBar(ctx, size, worldSize);

    // Pan indicator: show offset from centre when dragged
    if (this._panX !== 0 || this._panY !== 0) {
      ctx.save();
      ctx.font          = '9px Courier New, monospace';
      ctx.fillStyle     = 'rgba(79,195,247,0.5)';
      ctx.textAlign     = 'center';
      ctx.textBaseline  = 'bottom';
      ctx.fillText('drag to pan  ·  recenter ⊕', size / 2, size - 6);
      ctx.restore();
    }

    // Border
    ctx.strokeStyle = 'rgba(79,195,247,0.4)';
    ctx.lineWidth   = 2;
    ctx.strokeRect(1, 1, size - 2, size - 2);
  }

  // ── Private helpers ─────────────────────────────────────────────

  private _drawPlayerArrow(
    ctx: CanvasRenderingContext2D,
    cx: number, cy: number,
    yaw: number,
  ): void {
    const canvasAngle = Math.PI - yaw;
    const len  = 14;
    const wing = 7;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(canvasAngle);

    ctx.shadowColor = '#4fc3f7';
    ctx.shadowBlur  = 12;

    ctx.beginPath();
    ctx.moveTo(0, -len);
    ctx.lineTo(-wing, len / 2);
    ctx.lineTo(0, wing * 0.4);
    ctx.lineTo(wing, len / 2);
    ctx.closePath();
    ctx.fillStyle   = '#4fc3f7';
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth   = 1.5;
    ctx.stroke();

    ctx.shadowBlur = 0;

    ctx.beginPath();
    ctx.arc(0, 0, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();

    ctx.restore();

    ctx.save();
    ctx.font         = 'bold 9px Courier New, monospace';
    ctx.fillStyle    = '#4fc3f7';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'top';
    ctx.shadowColor  = '#000';
    ctx.shadowBlur   = 4;
    ctx.fillText('YOU', cx, cy + len + 4);
    ctx.restore();
  }

  private _drawShip(
    ctx: CanvasRenderingContext2D,
    sx: number, sy: number,
    shipYaw: number,
    isDriven: boolean,
  ): void {
    const canvasAngle = Math.PI - shipYaw;

    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(canvasAngle);

    if (isDriven) {
      ctx.shadowColor = '#fbbf24';
      ctx.shadowBlur  = 10;
    }

    ctx.beginPath();
    ctx.moveTo(0, -10);
    ctx.lineTo(6, 3);
    ctx.lineTo(5, 7);
    ctx.lineTo(-5, 7);
    ctx.lineTo(-6, 3);
    ctx.closePath();
    ctx.fillStyle   = isDriven ? 'rgba(251,191,36,0.95)' : 'rgba(141,110,99,0.95)';
    ctx.fill();
    ctx.strokeStyle = isDriven ? '#fef08a' : '#d7ccc8';
    ctx.lineWidth   = 1.5;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(0, -1, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = isDriven ? '#fef08a' : '#bcaaa4';
    ctx.fill();

    ctx.shadowBlur = 0;
    ctx.restore();
  }

  private _drawCompassRose(
    ctx: CanvasRenderingContext2D,
    cx: number, cy: number,
    r: number,
  ): void {
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(7,21,32,0.75)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(79,195,247,0.4)';
    ctx.lineWidth   = 1.5;
    ctx.stroke();

    const cardinals: Array<{ label: string; angle: number }> = [
      { label: 'N', angle: 0 },
      { label: 'E', angle: Math.PI / 2 },
      { label: 'S', angle: Math.PI },
      { label: 'W', angle: -Math.PI / 2 },
    ];

    ctx.font         = 'bold 9px Courier New, monospace';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';

    for (const { label, angle } of cardinals) {
      const lx  = cx + Math.sin(angle) * (r - 10);
      const ly  = cy - Math.cos(angle) * (r - 10);
      const t1x = cx + Math.sin(angle) * (r - 4);
      const t1y = cy - Math.cos(angle) * (r - 4);
      const t2x = cx + Math.sin(angle) * r;
      const t2y = cy - Math.cos(angle) * r;

      ctx.strokeStyle = label === 'N' ? '#f87171' : 'rgba(79,195,247,0.7)';
      ctx.lineWidth   = label === 'N' ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(t1x, t1y);
      ctx.lineTo(t2x, t2y);
      ctx.stroke();

      ctx.fillStyle = label === 'N' ? '#f87171' : 'rgba(200,230,255,0.9)';
      ctx.fillText(label, lx, ly);
    }

    ctx.restore();
  }

  private _drawScaleBar(
    ctx: CanvasRenderingContext2D,
    size: number,
    worldSize: number,
  ): void {
    const scaleUnits = Math.round(worldSize / 5);
    const barPx      = (scaleUnits / worldSize) * size;
    const bx         = 20;
    const by         = size - 20;

    ctx.save();
    ctx.strokeStyle = 'rgba(79,195,247,0.7)';
    ctx.lineWidth   = 2;
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(bx + barPx, by);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(bx, by - 4);          ctx.lineTo(bx, by + 4);
    ctx.moveTo(bx + barPx, by - 4);  ctx.lineTo(bx + barPx, by + 4);
    ctx.stroke();

    ctx.font         = '9px Courier New, monospace';
    ctx.fillStyle    = 'rgba(200,230,255,0.8)';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(`${scaleUnits} units`, bx + barPx / 2, by - 6);

    ctx.restore();
  }
}
