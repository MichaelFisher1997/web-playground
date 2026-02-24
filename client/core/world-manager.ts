import * as THREE from 'three';
import { WorldGenerator, DEFAULT_CONFIG, type WorldConfig } from '../world/generator.js';
import { createWater, resizeWaterUniforms, getWaterSurfaceHeight } from '../world/water.js';
import { createOceanFloor, updateOceanFloor } from '../world/ocean-floor.js';
import type { Minimap } from '../ui/minimap.js';
import type { GlobalMap } from '../ui/global-map.js';

export class WorldManager {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private skyMat: THREE.ShaderMaterial;
  private minimap: Minimap;
  private globalMap: GlobalMap;

  private _generator: WorldGenerator = new WorldGenerator();
  private _terrain: THREE.Mesh | null = null;
  private _water: THREE.Mesh | null = null;
  private _oceanFloor: THREE.Mesh | null = null;

  constructor(
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    skyMat: THREE.ShaderMaterial,
    minimap: Minimap,
    globalMap: GlobalMap,
  ) {
    this.scene = scene;
    this.camera = camera;
    this.skyMat = skyMat;
    this.minimap = minimap;
    this.globalMap = globalMap;
  }

  get generator(): WorldGenerator {
    return this._generator;
  }

  get water(): THREE.Mesh | null {
    return this._water;
  }

  get oceanFloor(): THREE.Mesh | null {
    return this._oceanFloor;
  }

  initWorld(config: Partial<WorldConfig> = {}, resetPosition: boolean = true): void {
    const worldConfig = { ...DEFAULT_CONFIG, ...config };

    this.disposeMesh(this._terrain);
    this.disposeMesh(this._water);
    this.disposeMesh(this._oceanFloor);
    this._terrain = null;
    this._water = null;
    this._oceanFloor = null;

    if (this.scene.fog) {
      (this.scene.fog as THREE.FogExp2).density = worldConfig.fogDensity;
      (this.scene as any)._targetFogDensity = worldConfig.fogDensity;
    }

    this._generator = new WorldGenerator(worldConfig);
    this._generator.generate();

    this._terrain = this._generator.createTerrain();
    this.scene.add(this._terrain);

    const islands = this._generator.getIslands();
    this._water = createWater({
      size: worldConfig.worldSize * 1.3,
      waterHeight: worldConfig.waterHeight,
      waveHeight: worldConfig.waveHeight,
      waveSpeed: worldConfig.waveSpeed,
      skyColorTop: this.skyMat.uniforms.uTop.value as THREE.Color,
      skyColorBottom: this.skyMat.uniforms.uBottom.value as THREE.Color,
      islandCenters: islands.map((isl) => ({ x: isl.x, z: isl.z })),
      islandRadii: islands.map((isl) => isl.radius),
    });
    this.scene.add(this._water);

    this._oceanFloor = createOceanFloor({
      size: worldConfig.worldSize * 1.5,
      depth: worldConfig.oceanDepth || -20,
    });
    this.scene.add(this._oceanFloor);

    this.scene.children
      .filter((obj) => obj.userData.isDecoration)
      .forEach((obj) => this.scene.remove(obj));
    this.addDecorations();

    if (resetPosition) {
      const spawn = this._generator.getSpawnPosition();
      this.camera.position.set(spawn.x, spawn.y + 10, spawn.z + 20);
    }

    this.minimap.bakeTexture(this._generator);
    this.globalMap.bakeTexture(this._generator);
  }

  resize(width: number, height: number): void {
    if (this._water) {
      resizeWaterUniforms(this._water, width, height);
    }
  }

  updateOceanFloor(time: number, sunDir: THREE.Vector3): void {
    if (this._oceanFloor) {
      updateOceanFloor(this._oceanFloor, time, sunDir);
    }
  }

  getRandomSpawnPosition(): { x: number; y: number; z: number } {
    const islands = this._generator.getIslands();
    if (islands.length === 0) {
      return { x: 0, y: 50, z: 0 };
    }
    const randomIsland = islands[Math.floor(Math.random() * islands.length)];
    const angle = Math.random() * Math.PI * 2;
    const dist = Math.random() * randomIsland.radius * 0.5;
    const x = randomIsland.x + Math.cos(angle) * dist;
    const z = randomIsland.z + Math.sin(angle) * dist;
    const y = this._generator.getHeightAt(x, z) + 2;
    return { x, y, z };
  }

  getWaterHeight(x: number, z: number, time: number): number {
    const config = this._generator.config;
    return getWaterSurfaceHeight(
      x,
      z,
      time,
      config.waterHeight,
      config.waveHeight,
      config.waveSpeed,
      this._generator.getIslands(),
    );
  }

  private addDecorations(): void {
    const islands = this._generator.getIslands();
    for (const island of islands) {
      const treeCount = Math.floor((island.radius / 20) * 5);
      for (let i = 0; i < treeCount; i++) {
        const angle = Math.random() * Math.PI * 2;
        const dist = Math.random() * island.radius * 0.8;
        const x = island.x + Math.cos(angle) * dist;
        const z = island.z + Math.sin(angle) * dist;
        const h = this._generator.sampleHeight(x, z);
        if (h < 1 || h > 20) continue;

        const trunkH = 1.2 + Math.random() * 0.8;
        const trunk = new THREE.Mesh(
          new THREE.CylinderGeometry(0.12, 0.18, trunkH, 5),
          new THREE.MeshLambertMaterial({ color: 0x5a3a1a }),
        );
        trunk.position.set(x, h + trunkH / 2, z);
        trunk.castShadow = true;
        trunk.userData.isDecoration = true;
        this.scene.add(trunk);

        const layers = 2 + Math.floor(Math.random() * 2);
        for (let l = 0; l < layers; l++) {
          const lh = 2.0 - l * 0.4;
          const cone = new THREE.Mesh(
            new THREE.ConeGeometry((1.4 - l * 0.3) + Math.random() * 0.4, lh, 6),
            new THREE.MeshLambertMaterial({
              color: new THREE.Color().setHSL(0.33 + Math.random() * 0.04, 0.6, 0.24 + Math.random() * 0.06),
            }),
          );
          cone.position.set(x, h + trunkH + l * (lh * 0.55) + lh / 2, z);
          cone.rotation.y = Math.random() * Math.PI;
          cone.castShadow = true;
          cone.userData.isDecoration = true;
          this.scene.add(cone);
        }
      }
    }
  }

  private disposeMesh(mesh: THREE.Mesh | null): void {
    if (!mesh) return;
    this.scene.remove(mesh);
    mesh.geometry.dispose();
    (mesh.material as THREE.Material).dispose();
  }
}
