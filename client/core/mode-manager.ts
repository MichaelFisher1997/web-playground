import * as THREE from 'three';
import type { WorldConfig } from '../world/generator.js';
import { PlayerController } from '../player/controller.js';
import { PlayModeController, type PlayControllerCallbacks } from '../player/play-controller.js';
import type { WorldManager } from './world-manager.js';
import type { ShipSystem } from '../systems/ship-system.js';

export interface ModeRuntimeState {
  gameState: 'menu' | 'playmenu' | 'sandbox' | 'playing' | 'paused';
  godModeActive: boolean;
  player: PlayerController | null;
  playController: PlayModeController | null;
  godPlayer: PlayerController | null;
}

export interface ModeManagerContext {
  state: ModeRuntimeState;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  hud: HTMLElement;
  worldManager: WorldManager;
  shipSystem: ShipSystem;
  initWorld: (config: Partial<WorldConfig>, resetPosition?: boolean) => void;
  hidePlayMenu: () => void;
  showSpawnPanel: () => void;
  hideSpawnPanel: () => void;
  disableSpawnMode: () => void;
  showSandboxPanel: () => void;
  showNotification: (message: string) => void;
  updateHealthBar: (health: number) => void;
  updateStaminaBar: (stamina: number) => void;
  getSensitivity: () => number;
  getSpeed: () => number;
}

export class ModeManager {
  private context: ModeManagerContext;

  constructor(context: ModeManagerContext) {
    this.context = context;
  }

  startPlayMode(config: WorldConfig): void {
    const { state } = this.context;
    state.gameState = 'playing';
    state.godModeActive = false;
    this.context.hidePlayMenu();
    this.context.hud.classList.remove('hidden');

    const hudBars = document.getElementById('hud-bars');
    if (hudBars) hudBars.style.display = 'flex';

    this.context.initWorld(config, false);
    const spawnPos = this.context.worldManager.getRandomSpawnPosition();

    const callbacks: PlayControllerCallbacks = {
      getShipDeckHeight: (x, z) => this.context.shipSystem.getHighestDeckHeightAt(x, z),
      onHealthChange: (health) => this.context.updateHealthBar(health),
      onStaminaChange: (stamina) => this.context.updateStaminaBar(stamina),
      onWaterDeath: () => this.context.showNotification('You fell into the water! Respawning...'),
      onEnterBoat: () => {
        if (!state.playController) return;
        this.context.shipSystem.enterBoat(state.playController, this.context.showNotification);
      },
      onExitBoat: () => {
        if (!state.playController) return;
        this.context.shipSystem.exitBoat(state.playController, this.context.showNotification);
      },
      onBoatInput: (thrust, steering) => {
        this.context.shipSystem.applyDrivenInput(thrust, steering);
      },
    };

    state.playController = new PlayModeController(
      this.context.scene,
      this.context.camera,
      this.context.worldManager.generator,
      spawnPos,
      callbacks,
    );
    state.playController.sensitivity = this.context.getSensitivity();
    this.context.updateHealthBar(100);
    this.context.updateStaminaBar(100);
    setTimeout(() => state.playController?.requestPointerLock(), 100);
  }

  startSandboxMode(): void {
    const { state } = this.context;
    state.gameState = 'sandbox';
    this.context.hud.classList.remove('hidden');
    this.context.initWorld({
      islandCount: 1,
      minIslandSize: 180,
      maxIslandSize: 220,
      noiseFrequency: 1.2,
      noiseOctaves: 7,
      worldSize: 600,
      resolution: 200,
      fogDensity: 0.003,
    });
    state.player = new PlayerController(this.context.scene, this.context.camera, 'god');
    state.player.sensitivity = this.context.getSensitivity();
    state.player.speed = this.context.getSpeed();
    this.context.showSandboxPanel();
    this.context.showSpawnPanel();
  }

  toggleGodMode(): void {
    const { state } = this.context;
    if (state.gameState !== 'playing') return;
    state.godModeActive = !state.godModeActive;

    if (state.godModeActive) {
      state.playController?.releasePointerLock();
      const currentPos = state.playController
        ? state.playController.getState().position
        : { x: this.context.camera.position.x, y: this.context.camera.position.y, z: this.context.camera.position.z };
      if (!state.godPlayer) {
        state.godPlayer = new PlayerController(this.context.scene, this.context.camera, 'god');
        state.godPlayer.sensitivity = this.context.getSensitivity();
        state.godPlayer.speed = this.context.getSpeed();
      }
      this.context.camera.position.set(currentPos.x, currentPos.y + 15, currentPos.z + 10);
      state.godPlayer.requestPointerLock();
      this.context.showSpawnPanel();
      this.context.showNotification('God Mode ON - Press Y to exit');
    } else {
      state.godPlayer?.releasePointerLock();
      this.context.hideSpawnPanel();
      this.context.disableSpawnMode();
      state.playController?.requestPointerLock();
      this.context.showNotification('God Mode OFF');
    }
  }
}
