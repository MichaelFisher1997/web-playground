import { WorldGenerator } from '../world/generator.js';
import type { SpawnedShip } from '../objects/ship.js';

export interface MinimapOptions {
  /** Canvas element to draw into */
  canvas: HTMLCanvasElement;
  /** Radius of world area shown (world units) */
  range?: number;
}

// --- colour helpers matching generator.ts getIslandColor logic ---
function terrainColor(h: number, normalizedHeight: number, islandType: string | undefined): [number, number, number] {
  const waterHeight = -1.0;
  const oceanDepth  = -15;

  // Deep ocean
  if (h < oceanDepth + 2) {
    const t = Math.max(0, Math.min(1, (h - oceanDepth) / 2));
    return lerpRGB([0x0d, 0x1f, 0x2e], [0x1a, 0x3d, 0x5c], t);
  }
  // Underwater slope
  if (h < waterHeight - 1) {
    const t = Math.max(0, Math.min(1, (h - (waterHeight - 5)) / 4));
    return lerpRGB([0x1a, 0x3d, 0x5c], [0x8b, 0x73, 0x55], t * 0.5);
  }
  // Shallow / wet sand
  if (h < waterHeight + 0.5) {
    const t = Math.max(0, Math.min(1, (h - (waterHeight - 1)) / 1.5));
    return lerpRGB([0xc9, 0xa8, 0x6c], [0xe8, 0xd4, 0xa8], t);
  }
  // Beach → grass
  if (h < waterHeight + 2) {
    const t = Math.max(0, Math.min(1, (h - (waterHeight + 0.5)) / 1.5));
    return lerpRGB([0xe8, 0xd4, 0xa8], [0x4a, 0x8c, 0x3f], t);
  }

  const nt = normalizedHeight;
  switch (islandType || 'tropical') {
    case 'tropical':
      if (nt < 0.2) return [0x4a, 0x8c, 0x3f];
      if (nt < 0.4) return [0x3a, 0x7a, 0x30];
      if (nt < 0.6) return [0x5a, 0x60, 0x50];
      if (nt < 0.8) return [0x8a, 0x88, 0x80];
      return [0xff, 0xff, 0xff];
    case 'rocky':
      if (nt < 0.2) return [0x5a, 0x6a, 0x50];
      if (nt < 0.5) return [0x6a, 0x6a, 0x60];
      return [0x8a, 0x88, 0x80];
    case 'sandy':
      if (nt < 0.3) return [0xd4, 0xc4, 0x9a];
      if (nt < 0.6) return [0xc4, 0xb4, 0x8a];
      return [0xa0, 0xa0, 0x90];
    default:
      return [0x4a, 0x8c, 0x3f];
  }
}

function lerpRGB(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

// ---------------------------------------------------------------

export class Minimap {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private range: number;

  /** Offscreen canvas holding the pre-baked terrain texture */
  private terrainCanvas: HTMLCanvasElement | null = null;
  /** Total world size (units) of the baked canvas */
  private bakedWorldSize = 0;

  constructor(opts: MinimapOptions) {
    this.canvas = opts.canvas;
    this.ctx = opts.canvas.getContext('2d')!;
    this.range = opts.range ?? 200;
  }

  /** Pre-bake the full terrain to an offscreen canvas.
   *  Should be called once after WorldGenerator.generate(). */
  bakeTexture(gen: WorldGenerator): void {
    const worldSize  = gen.config.worldSize;
    const maxH       = gen.config.maxTerrainHeight;
    const resolution = 256; // baked texture resolution (power-of-2 for performance)

    const off = document.createElement('canvas');
    off.width  = resolution;
    off.height = resolution;
    const offCtx = off.getContext('2d')!;
    const imgData = offCtx.createImageData(resolution, resolution);
    const data    = imgData.data;

    const islands = gen.getIslands();
    const half = worldSize / 2;
    const step = worldSize / resolution;

    for (let row = 0; row < resolution; row++) {
      for (let col = 0; col < resolution; col++) {
        // World coords: row → z, col → x
        const wx = -half + col * step + step * 0.5;
        const wz = -half + row * step + step * 0.5;

        const h = gen.getHeightAt(wx, wz);

        // Find closest island for type lookup
        let closestIsland: typeof islands[0] | null = null;
        let minDist = Infinity;
        for (const isl of islands) {
          const d = Math.hypot(wx - isl.x, wz - isl.z);
          if (d < minDist) { minDist = d; closestIsland = isl; }
        }

        const normalizedH = Math.max(0, h) / maxH;
        const [r, g, b] = terrainColor(h, normalizedH, closestIsland?.type);

        const idx = (row * resolution + col) * 4;
        data[idx]     = r;
        data[idx + 1] = g;
        data[idx + 2] = b;
        data[idx + 3] = 255;
      }
    }

    offCtx.putImageData(imgData, 0, 0);

    // Slight blur for a softer look - applied via in-place redraw
    offCtx.filter = 'blur(0.5px)';
    offCtx.drawImage(off, 0, 0);
    offCtx.filter = 'none';

    this.terrainCanvas  = off;
    this.bakedWorldSize = worldSize;
  }

  /**
   * Call each frame from the game loop.
   * @param playerWorldX  Player X in world space
   * @param playerWorldZ  Player Z in world space
   * @param playerYaw     Camera yaw in radians (0 = north/-Z, increases clockwise)
   * @param ships         Spawned ships array
   * @param drivenShip    Currently driven ship (or null)
   * @param remotePlayers Array of { x, z, color } for other players
   */
  update(
    playerWorldX: number,
    playerWorldZ: number,
    playerYaw: number,
    ships: SpawnedShip[],
    drivenShip: SpawnedShip | null,
    remotePlayers: Array<{ position: { x: number; z: number }; color: number }>,
  ): void {
    const size = this.canvas.width;  // canvas logical size (e.g. 180)
    const half = size / 2;
    const ctx  = this.ctx;

    ctx.clearRect(0, 0, size, size);

    // ── 1. Clip to circle ──────────────────────────────────────────
    ctx.save();
    ctx.beginPath();
    ctx.arc(half, half, half - 1, 0, Math.PI * 2);
    ctx.clip();

    // ── 2. Ocean fill (base) ───────────────────────────────────────
    ctx.fillStyle = '#0d2a45';
    ctx.fillRect(0, 0, size, size);

    // ── 3. Terrain texture centered on player ─────────────────────
    if (this.terrainCanvas) {
      const wSize = this.bakedWorldSize;
      const texRes = this.terrainCanvas.width;

      // How many texels correspond to our world range?
      const texelsPerUnit = texRes / wSize;
      const visibleTexels = this.range * 2 * texelsPerUnit;

      // Source rect in the baked texture (player at centre)
      const playerTexX = ((playerWorldX + wSize / 2) / wSize) * texRes;
      const playerTexZ = ((playerWorldZ + wSize / 2) / wSize) * texRes;

      const srcX = playerTexX - visibleTexels / 2;
      const srcZ = playerTexZ - visibleTexels / 2;

      ctx.save();
      // Rotate terrain so north always points up
      ctx.translate(half, half);
      // No rotation - keep fixed orientation (north up)
      ctx.translate(-half, -half);

      ctx.drawImage(
        this.terrainCanvas,
        srcX, srcZ, visibleTexels, visibleTexels,
        0, 0, size, size,
      );
      ctx.restore();
    }

    // ── 4. Dark vignette ring ──────────────────────────────────────
    const vigGrad = ctx.createRadialGradient(half, half, half * 0.65, half, half, half);
    vigGrad.addColorStop(0, 'rgba(0,0,0,0)');
    vigGrad.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = vigGrad;
    ctx.fillRect(0, 0, size, size);

    ctx.restore();  // restore circle clip

    // ── 5. Border ring ─────────────────────────────────────────────
    ctx.beginPath();
    ctx.arc(half, half, half - 1, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(79,195,247,0.55)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // ── 6. Compass tick marks & labels ────────────────────────────
    this._drawCompass(ctx, half, playerYaw);

    // ── 7. Scale line (bottom of minimap) ─────────────────────────
    const worldPerPixel = (this.range * 2) / size;
    const scaleUnits = 50; // show 50 world-units scale bar
    const scalePixels = scaleUnits / worldPerPixel;
    const barY = size - 8;
    const barX = half - scalePixels / 2;
    ctx.save();
    ctx.strokeStyle = 'rgba(79,195,247,0.55)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(barX, barY);
    ctx.lineTo(barX + scalePixels, barY);
    ctx.stroke();
    ctx.restore();

    // ── 8. Ships ──────────────────────────────────────────────────
    const scale = size / (this.range * 2);
    for (const ship of ships) {
      const dx = ship.body.position.x - playerWorldX;
      const dz = ship.body.position.z - playerWorldZ;
      if (Math.hypot(dx, dz) > this.range * 1.05) continue;

      const sx = half + dx * scale;
      const sy = half + dz * scale;
      const isDriven = ship === drivenShip;
      this._drawShipIcon(ctx, sx, sy, ship.body.rotation.y, isDriven);
    }

    // ── 9. Remote players ─────────────────────────────────────────
    for (const rp of remotePlayers) {
      const dx = rp.position.x - playerWorldX;
      const dz = rp.position.z - playerWorldZ;
      if (Math.hypot(dx, dz) > this.range) continue;

      const sx = half + dx * scale;
      const sy = half + dz * scale;
      const hex = '#' + rp.color.toString(16).padStart(6, '0');
      ctx.save();
      ctx.beginPath();
      ctx.arc(sx, sy, 4, 0, Math.PI * 2);
      ctx.fillStyle = hex;
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.restore();
    }

    // ── 10. Player arrow (always centre) ─────────────────────────
    this._drawPlayerArrow(ctx, half, half, playerYaw);
  }

  // ── Private helpers ────────────────────────────────────────────

  private _drawCompass(ctx: CanvasRenderingContext2D, half: number, playerYaw: number): void {
    const radius = half - 2;

    // Cardinal directions - fixed (not rotating with player)
    // Yaw=0 → looking toward -Z (north on map = up)
    // Yaw rotates clockwise → player looks east when yaw = π/2
    // Map: north = up (canvas -Y), east = right (+X)
    const cardinals: Array<{ label: string; angle: number }> = [
      { label: 'N', angle: 0 },
      { label: 'E', angle: Math.PI / 2 },
      { label: 'S', angle: Math.PI },
      { label: 'W', angle: -Math.PI / 2 },
    ];

    ctx.save();
    ctx.font = 'bold 8px Courier New, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (const { label, angle } of cardinals) {
      // angle=0 → top of canvas, angle=π/2 → right, etc.
      const labelR = radius - 6;
      const lx = half + Math.sin(angle) * labelR;
      const ly = half - Math.cos(angle) * labelR;

      // Tick mark
      const tickOuter = radius - 1;
      const tickInner = radius - 7;
      const tx1 = half + Math.sin(angle) * tickInner;
      const ty1 = half - Math.cos(angle) * tickInner;
      const tx2 = half + Math.sin(angle) * tickOuter;
      const ty2 = half - Math.cos(angle) * tickOuter;
      ctx.strokeStyle = label === 'N' ? '#f87171' : 'rgba(79,195,247,0.7)';
      ctx.lineWidth = label === 'N' ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(tx1, ty1);
      ctx.lineTo(tx2, ty2);
      ctx.stroke();

      // Label
      ctx.fillStyle = label === 'N' ? '#f87171' : 'rgba(200,230,255,0.85)';
      ctx.fillText(label, lx, ly);
    }

    ctx.restore();
  }

  private _drawPlayerArrow(ctx: CanvasRenderingContext2D, cx: number, cy: number, yaw: number): void {
    // Coordinate convention:
    //   World: +X = east, +Z = south (canvas +Y)
    //   yaw=0 → forward=(sin0, cos0)=(0,1) in (X,Z) → faces SOUTH (+Z, canvas down)
    //   yaw=π → faces NORTH (-Z, canvas up)
    //
    // Arrow tip at (0, -len) before rotation = pointing canvas UP (north).
    // After ctx.rotate(θ), tip moves to (len·sinθ, -len·cosθ).
    // We want tip to point toward (sin(yaw), cos(yaw)) in canvas (X,+Z=down).
    // So: sinθ = sin(yaw) and -cosθ = cos(yaw) → θ = π - yaw
    const canvasAngle = Math.PI - yaw;

    const len  = 10;
    const wing = 5;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(canvasAngle);

    // Arrow body
    ctx.beginPath();
    ctx.moveTo(0, -len);      // tip
    ctx.lineTo(-wing, len / 2);
    ctx.lineTo(0,  wing * 0.4);
    ctx.lineTo(wing, len / 2);
    ctx.closePath();

    ctx.fillStyle = '#4fc3f7';
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Centre dot
    ctx.beginPath();
    ctx.arc(0, 0, 3, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();

    ctx.restore();
  }

  private _drawShipIcon(
    ctx: CanvasRenderingContext2D,
    sx: number, sy: number,
    shipYaw: number,
    isDriven: boolean,
  ): void {
    // Same yaw convention as player: yaw=0 → bow faces +Z (canvas down)
    // Bow is drawn at (0, -8) = canvas up, so apply the same π - yaw correction.
    const canvasAngle = Math.PI - shipYaw;

    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(canvasAngle);

    // Hull outline
    ctx.beginPath();
    ctx.moveTo(0, -8);    // bow
    ctx.lineTo(5, 2);
    ctx.lineTo(4, 5);
    ctx.lineTo(-4, 5);
    ctx.lineTo(-5, 2);
    ctx.closePath();

    ctx.fillStyle = isDriven ? 'rgba(251,191,36,0.9)' : 'rgba(141,110,99,0.9)';
    ctx.fill();
    ctx.strokeStyle = isDriven ? '#fef08a' : '#d7ccc8';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Mast dot
    ctx.beginPath();
    ctx.arc(0, -1, 2, 0, Math.PI * 2);
    ctx.fillStyle = isDriven ? '#fef08a' : '#bcaaa4';
    ctx.fill();

    ctx.restore();
  }
}
