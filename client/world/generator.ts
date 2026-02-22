import * as THREE from 'three';
import { SeededNoise } from './noise';
import { IslandPlacer, Island, WorldConfig } from './islands';

export type { WorldConfig } from './islands';
export type { Island } from './islands';

export const DEFAULT_CONFIG: WorldConfig = {
  seed: 12345,
  worldSize: 400,
  resolution: 120,
  islandCount: 8,
  minIslandSize: 25,
  maxIslandSize: 70,
  noiseFrequency: 2.5,
  noiseOctaves: 5,
  noiseLacunarity: 2.2,
  noisePersistence: 0.45,
  waterHeight: -1.0,
  waveHeight: 1.2,
  waveSpeed: 0.7,
  maxTerrainHeight: 35,
  oceanDepth: -15,
  fogDensity: 0.004
};

export class WorldGenerator {
  config: WorldConfig;
  noise: SeededNoise;
  private islandPlacer: IslandPlacer | null = null;
  private islands: Island[] = [];
  terrainMesh: THREE.Mesh | null = null;

  constructor(config: Partial<WorldConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.noise = new SeededNoise(this.config.seed);
  }

  setConfig(newConfig: Partial<WorldConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  reseed(seed: number | string): void {
    this.config.seed = seed;
    this.noise.reseed(seed);
  }

  generate(): this {
    this.noise.reseed(this.config.seed);
    this.islandPlacer = new IslandPlacer(this.config, this.noise);
    this.islands = this.islandPlacer.placeIslands();
    return this;
  }

  getHeightAt(x: number, z: number): number {
    const { noiseFrequency, noiseOctaves, noiseLacunarity, noisePersistence, maxTerrainHeight, oceanDepth, waterHeight } = this.config;
    
    let highestBlend = 0;
    let blendedHeight = oceanDepth;
    let closestIsland: Island | null = null;
    let closestDist = Infinity;

    for (const island of this.islands) {
      const dx = x - island.x;
      const dz = z - island.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      
      // Track closest island for blending
      if (dist < closestDist) {
        closestDist = dist;
        closestIsland = island;
      }
      
      // Extended radius for underwater slopes (1.8x island radius - steeper drop-off)
      const slopeRadius = island.radius * 1.8;
      if (dist > slopeRadius) continue;

      // Calculate normalized distance (0 = center, 1 = edge of slope)
      const normalizedDist = dist / slopeRadius;
      
      // Create steep transition curve to keep islands separate
      // 0-0.4: Island interior (full height)
      // 0.4-0.7: Beach/shoreline (quick transition to water level)
      // 0.7-1.0: Steep underwater slope (quick drop to ocean floor)
      let elevationFactor: number;
      if (normalizedDist < 0.4) {
        // Island interior - full height with some noise
        elevationFactor = 1.0;
      } else if (normalizedDist < 0.7) {
        // Beach/shoreline - quick transition to water level
        const t = (normalizedDist - 0.4) / 0.3;
        // Steeper drop for beach
        elevationFactor = 1.0 - Math.pow(t, 0.7) * 0.85;
      } else {
        // Underwater slope - steep drop to ocean floor
        const t = (normalizedDist - 0.7) / 0.3;
        // Steep transition down to ocean floor
        const underwaterFactor = 1.0 - Math.pow(t, 0.5);
        elevationFactor = 0.15 * underwaterFactor;
      }

      if (elevationFactor < 0.01) continue;

      // Generate terrain noise
      const nx = (x + island.noiseOffsetX) / island.radius * noiseFrequency;
      const nz = (z + island.noiseOffsetZ) / island.radius * noiseFrequency;
      
      let raw = this.noise.fbm(nx, nz, noiseOctaves, noiseLacunarity, noisePersistence);
      raw = (raw + 1) / 2;
      
      // Add micro-detail for beach areas
      let detail = 0;
      if (normalizedDist > 0.25 && normalizedDist < 0.7) {
        const detailNoise = this.noise.noise2D(nx * 3, nz * 3);
        detail = detailNoise * 0.8; // Beach texture variation
      }
      
      const islandHeight = (raw * maxTerrainHeight * island.heightMultiplier + detail) * elevationFactor;
      
      // Blend between ocean floor and island height
      const blendFactor = Math.max(0, 1 - normalizedDist);
      if (blendFactor > highestBlend) {
        highestBlend = blendFactor;
        // Smooth blend between ocean floor and island
        const smoothBlend = blendFactor * blendFactor * (3 - 2 * blendFactor);
        blendedHeight = oceanDepth + (islandHeight - oceanDepth) * smoothBlend;
      }
    }

    // Add subtle underwater terrain variation even far from islands
    if (highestBlend < 0.5) {
      const seabedNoise = this.noise.fbm(x * 0.01, z * 0.01, 3, 2, 0.5);
      const seabedVariation = seabedNoise * 3; // ±3 units of variation
      blendedHeight += seabedVariation * (1 - highestBlend);
    }

    return blendedHeight;
  }

  private getIslandColor(h: number, island: Island | null, normalizedHeight: number, x: number, z: number): THREE.Color {
    const { waterHeight, oceanDepth } = this.config;
    
    // Deep ocean floor
    if (h < oceanDepth + 2) {
      const deep = new THREE.Color(0x1a3d5c);
      const darker = new THREE.Color(0x0d1f2e);
      const t = Math.max(0, Math.min(1, (h - oceanDepth) / 2));
      return darker.clone().lerp(deep, t);
    }
    
    // Underwater slope - transition from dark blue to sand
    if (h < waterHeight - 1) {
      const underwater = new THREE.Color(0x1a3d5c);
      const sand = new THREE.Color(0x8b7355);
      const t = Math.max(0, Math.min(1, (h - (waterHeight - 5)) / 4));
      return underwater.clone().lerp(sand, t * 0.5);
    }
    
    // Shallow water / wet sand near shore
    if (h < waterHeight + 0.5) {
      const wetSand = new THREE.Color(0xc9a86c);
      const drySand = new THREE.Color(0xe8d4a8);
      const t = Math.max(0, Math.min(1, (h - (waterHeight - 1)) / 1.5));
      return wetSand.clone().lerp(drySand, t);
    }
    
    // Beach / low vegetation
    if (h < waterHeight + 2) {
      const sand = new THREE.Color(0xe8d4a8);
      const grass = new THREE.Color(0x4a8c3f);
      const t = Math.max(0, Math.min(1, (h - (waterHeight + 0.5)) / 1.5));
      return sand.clone().lerp(grass, t);
    }

    // Higher terrain based on island type
    const t = normalizedHeight;
    
    switch (island?.type || 'tropical') {
      case 'tropical':
        if (t < 0.2) return new THREE.Color(0x4a8c3f);  // Lush green
        if (t < 0.4) return new THREE.Color(0x3a7a30);  // Darker green
        if (t < 0.6) return new THREE.Color(0x5a6050);  // Rocky
        if (t < 0.8) return new THREE.Color(0x8a8880);  // Gray rock
        return new THREE.Color(0xffffff);                // Snow caps
      case 'rocky':
        if (t < 0.2) return new THREE.Color(0x5a6a50);  // Mossy rock
        if (t < 0.5) return new THREE.Color(0x6a6a60);  // Gray rock
        return new THREE.Color(0x8a8880);                // Light rock
      case 'sandy':
        if (t < 0.3) return new THREE.Color(0xd4c49a);  // Sand
        if (t < 0.6) return new THREE.Color(0xc4b48a);  // Darker sand
        return new THREE.Color(0xa0a090);                // Rock
      default:
        return new THREE.Color(0x4a8c3f);
    }
  }

  private getClosestIsland(x: number, z: number): Island | null {
    let closest: Island | null = null;
    let minDist = Infinity;
    
    for (const island of this.islands) {
      const dx = x - island.x;
      const dz = z - island.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist < minDist) {
        minDist = dist;
        closest = island;
      }
    }
    
    return closest;
  }

  createTerrain(): THREE.Mesh {
    const { worldSize, resolution, maxTerrainHeight } = this.config;
    const geometry = new THREE.PlaneGeometry(worldSize, worldSize, resolution, resolution);
    geometry.rotateX(-Math.PI / 2);

    const positions = geometry.attributes.position;
    const colors = new Float32Array(positions.count * 3);
    const halfSize = worldSize / 2;

    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i);
      const z = positions.getZ(i);

      const h = this.getHeightAt(x, z);
      positions.setY(i, h);

      const closestIsland = this.getClosestIsland(x, z);
      const normalizedHeight = Math.max(0, h) / maxTerrainHeight;
      const col = this.getIslandColor(h, closestIsland, normalizedHeight, x, z);
      
      colors[i * 3] = col.r;
      colors[i * 3 + 1] = col.g;
      colors[i * 3 + 2] = col.b;
    }

    positions.needsUpdate = true;
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.computeVertexNormals();

    const material = new THREE.MeshLambertMaterial({
      vertexColors: true,
      flatShading: true
    });

    this.terrainMesh = new THREE.Mesh(geometry, material);
    this.terrainMesh.receiveShadow = true;
    this.terrainMesh.castShadow = true;
    this.terrainMesh.name = 'terrain';
    
    this.terrainMesh.userData = {
      resolution,
      worldSize,
      positions,
      generator: this
    };

    return this.terrainMesh;
  }

  sampleHeight(x: number, z: number): number {
    return this.getHeightAt(x, z);
  }

  getSpawnPosition(): { x: number; y: number; z: number } {
    if (this.islands.length === 0) {
      return { x: 0, y: 50, z: 0 };
    }

    const mainIsland = this.islands[0];
    const spawnX = mainIsland.x;
    const spawnZ = mainIsland.z;
    const spawnY = this.getHeightAt(spawnX, spawnZ) + 5;

    return { x: spawnX, y: Math.max(spawnY, 10), z: spawnZ };
  }

  getConfig(): WorldConfig {
    return { ...this.config };
  }

  getIslands(): Island[] {
    return [...this.islands];
  }
}
