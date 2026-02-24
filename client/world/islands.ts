import type { SeededNoise } from './noise';

export interface Island {
  x: number;
  z: number;
  radius: number;
  heightMultiplier: number;
  noiseOffsetX: number;
  noiseOffsetZ: number;
  edgeFalloff: number;
  type: IslandType;
}

export type IslandType = 'tropical' | 'rocky' | 'sandy';

export interface WorldGenerationConfig {
  seed: number | string;
  worldSize: number;
  resolution: number;
  islandCount: number;
  minIslandSize: number;
  maxIslandSize: number;
}

export interface NoiseConfig {
  noiseFrequency: number;
  noiseOctaves: number;
  noiseLacunarity: number;
  noisePersistence: number;
}

export interface WaterSurfaceConfig {
  waterHeight: number;
  waveHeight: number;
  waveSpeed: number;
}

export interface AtmosphereConfig {
  maxTerrainHeight: number;
  oceanDepth: number;
  fogDensity: number;
}

export interface WorldConfig extends WorldGenerationConfig, NoiseConfig, WaterSurfaceConfig, AtmosphereConfig {}

export class IslandPlacer {
  private config: WorldConfig;
  private noise: SeededNoise;
  private islands: Island[] = [];

  constructor(config: WorldConfig, noise: SeededNoise) {
    this.config = config;
    this.noise = noise;
  }

  private poissonDisk(radius: number, attempts: number = 30): { x: number; z: number }[] {
    const { worldSize } = this.config;
    const halfSize = worldSize / 2;
    const cellSize = radius / Math.sqrt(2);
    const gridW = Math.ceil(worldSize / cellSize);
    const grid = new Array<number>(gridW * gridW).fill(-1);
    const points: { x: number; z: number }[] = [];

    const gridIndex = (x: number, z: number): number => {
      const gx = Math.floor((x + halfSize) / cellSize);
      const gz = Math.floor((z + halfSize) / cellSize);
      if (gx < 0 || gx >= gridW || gz < 0 || gz >= gridW) return -1;
      return gz * gridW + gx;
    };

    const firstX = this.noise.randomRange(-halfSize * 0.8, halfSize * 0.8);
    const firstZ = this.noise.randomRange(-halfSize * 0.8, halfSize * 0.8);
    points.push({ x: firstX, z: firstZ });
    const gi = gridIndex(firstX, firstZ);
    if (gi >= 0) grid[gi] = 0;

    const active: number[] = [0];

    while (active.length > 0) {
      const randIdx = Math.floor(this.noise.random() * active.length);
      const pointIdx = active[randIdx];
      const point = points[pointIdx];
      let found = false;

      for (let i = 0; i < attempts; i++) {
        const angle = this.noise.random() * Math.PI * 2;
        const dist = this.noise.randomRange(radius, radius * 2);
        const nx = point.x + Math.cos(angle) * dist;
        const nz = point.z + Math.sin(angle) * dist;

        if (Math.abs(nx) > halfSize * 0.95 || Math.abs(nz) > halfSize * 0.95) continue;

        const ngi = gridIndex(nx, nz);
        if (ngi < 0) continue;

        let tooClose = false;
        const gx = Math.floor((nx + halfSize) / cellSize);
        const gz = Math.floor((nz + halfSize) / cellSize);

        outer: for (let dz = -2; dz <= 2 && !tooClose; dz++) {
          for (let dx = -2; dx <= 2 && !tooClose; dx++) {
            const neighborGi = (gz + dz) * gridW + (gx + dx);
            if (neighborGi < 0 || neighborGi >= grid.length) continue;
            const neighborIdx = grid[neighborGi];
            if (neighborIdx >= 0) {
              const neighbor = points[neighborIdx];
              const ddx = nx - neighbor.x;
              const ddz = nz - neighbor.z;
              if (ddx * ddx + ddz * ddz < radius * radius) {
                tooClose = true;
                break outer;
              }
            }
          }
        }

        if (!tooClose) {
          points.push({ x: nx, z: nz });
          grid[ngi] = points.length - 1;
          active.push(points.length - 1);
          found = true;
          break;
        }
      }

      if (!found) {
        active.splice(randIdx, 1);
      }
    }

    return points;
  }

  private determineIslandType(): Island['type'] {
    const r = this.noise.random();
    if (r < 0.5) return 'tropical';
    if (r < 0.8) return 'rocky';
    return 'sandy';
  }

  placeIslands(): Island[] {
    const { islandCount, minIslandSize, maxIslandSize, worldSize } = this.config;
    const halfSize = worldSize / 2;

    this.islands = [];
    if (islandCount <= 0) return this.islands;

    if (islandCount === 1) {
      // For a single island, always place it in the center
      const size = this.noise.randomRange(minIslandSize, maxIslandSize);
      this.islands.push({
        x: 0,
        z: 0,
        radius: size,
        heightMultiplier: 1.5,
        noiseOffsetX: this.noise.randomRange(-100, 100),
        noiseOffsetZ: this.noise.randomRange(-100, 100),
        edgeFalloff: 1.0,
        type: 'rocky'
      });
      return this.islands;
    }

    const avgRadius = (minIslandSize + maxIslandSize) / 2;
    const spacing = avgRadius * 2.5;
    const candidates = this.poissonDisk(spacing);

    const targetCount = Math.min(islandCount, candidates.length);

    for (let i = 0; i < targetCount; i++) {
      const point = candidates[i];
      const size = this.noise.randomRange(minIslandSize, maxIslandSize);
      const heightMultiplier = this.noise.randomRange(0.7, 1.4);
      const noiseOffsetX = this.noise.randomRange(-100, 100);
      const noiseOffsetZ = this.noise.randomRange(-100, 100);

      const distFromCenter = Math.sqrt(point.x * point.x + point.z * point.z);
      const edgeFalloff = Math.max(0, 1 - (distFromCenter / (halfSize * 0.85)));

      this.islands.push({
        x: point.x,
        z: point.z,
        radius: size,
        heightMultiplier,
        noiseOffsetX,
        noiseOffsetZ,
        edgeFalloff,
        type: this.determineIslandType()
      });
    }

    return this.islands;
  }

  getIslands(): Island[] {
    return this.islands;
  }
}
