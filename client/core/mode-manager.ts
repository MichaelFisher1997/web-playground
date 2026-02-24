import * as THREE from 'three';
import type { WorldConfig } from '../world/generator.js';
import { PlayerController } from '../player/controller.js';
import { PlayModeController, type PlayControllerCallbacks } from '../player/play-controller.js';
import type { SpawnedShip } from '../objects/ship.js';
import type { WorldManager } from './world-manager.js';

export interface ModeRuntimeState {
  gameState: 'menu' | 'playmenu' | 'sandbox' | 'playing' | 'paused';
  godModeActive: boolean;
  player: PlayerController | null;
  playController: PlayModeController | null;
  godPlayer: PlayerController | null;
  drivenShip: SpawnedShip | null;
  deckOffset: { x: number; z: number };
}

export interface ModeManagerContext {
  state: ModeRuntimeState;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  hud: HTMLElement;
  worldManager: WorldManager;
  spawnedShips: SpawnedShip[];
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
  getDeckHeightAt: (ship: SpawnedShip, x: number, z: number) => number | null;
  applyBoatInput: (body: SpawnedShip['body'], thrust: number, steering: number) => void;
}

export function startPlayMode(context: ModeManagerContext, config: WorldConfig): void {
  const { state } = context;
  state.gameState = 'playing';
  state.godModeActive = false;
  context.hidePlayMenu();
  context.hud.classList.remove('hidden');

  const hudBars = document.getElementById('hud-bars');
  if (hudBars) hudBars.style.display = 'flex';

  context.initWorld(config, false);
  const spawnPos = context.worldManager.getRandomSpawnPosition();

  const callbacks: PlayControllerCallbacks = {
    getShipDeckHeight: (x, z) => {
      let highestDeck: number | null = null;
      for (const ship of context.spawnedShips) {
        const deckY = context.getDeckHeightAt(ship, x, z);
        if (deckY !== null && (highestDeck === null || deckY > highestDeck)) {
          highestDeck = deckY;
        }
      }
      return highestDeck;
    },
    onHealthChange: (health) => context.updateHealthBar(health),
    onStaminaChange: (stamina) => context.updateStaminaBar(stamina),
    onWaterDeath: () => context.showNotification('You fell into the water! Respawning...'),
    onEnterBoat: () => {
      const playerPos = state.playController?.getCharacterPosition();
      if (!playerPos) return;
      for (const ship of context.spawnedShips) {
        const deckY = context.getDeckHeightAt(ship, playerPos.x, playerPos.z);
        if (deckY === null) continue;
        state.drivenShip = ship;
        state.deckOffset.x = 1.8;
        state.deckOffset.z = 0;
        const shipPos = ship.body.position;
        const shipRot = ship.body.rotation.y;
        const cos = Math.cos(shipRot);
        const sin = Math.sin(shipRot);
        const helmX = shipPos.x + state.deckOffset.x * cos - state.deckOffset.z * sin;
        const helmZ = shipPos.z + state.deckOffset.x * sin + state.deckOffset.z * cos;
        const helmY = context.getDeckHeightAt(ship, helmX, helmZ) ?? deckY;
        state.playController?.setPosition(helmX, helmY, helmZ);
        state.playController?.setDrivingBoat(true);
        context.showNotification('Driving boat! WASD to steer, E to exit');
        break;
      }
    },
    onExitBoat: () => {
      if (state.drivenShip && state.playController) {
        const shipPos = state.drivenShip.body.position;
        const shipRot = state.drivenShip.body.rotation.y;
        const cos = Math.cos(shipRot);
        const sin = Math.sin(shipRot);
        const exitX = shipPos.x + state.deckOffset.x * cos - state.deckOffset.z * sin + 2;
        const exitZ = shipPos.z + state.deckOffset.x * sin + state.deckOffset.z * cos;
        const exitY = context.getDeckHeightAt(state.drivenShip, exitX, exitZ) ?? shipPos.y + 2;
        state.playController.setPosition(exitX, exitY, exitZ);
        state.playController.setDrivingBoat(false);
      }
      state.drivenShip = null;
      context.showNotification('Exited boat');
    },
    onBoatInput: (thrust, steering) => {
      if (state.drivenShip) {
        context.applyBoatInput(state.drivenShip.body, thrust, steering);
      }
    },
  };

  state.playController = new PlayModeController(context.scene, context.camera, context.worldManager.generator, spawnPos, callbacks);
  state.playController.sensitivity = context.getSensitivity();
  context.updateHealthBar(100);
  context.updateStaminaBar(100);
  setTimeout(() => state.playController?.requestPointerLock(), 100);
}

export function startSandboxMode(context: ModeManagerContext): void {
  const { state } = context;
  state.gameState = 'sandbox';
  context.hud.classList.remove('hidden');
  const singleIslandConfig: Partial<WorldConfig> = {
    islandCount: 1,
    minIslandSize: 180,
    maxIslandSize: 220,
    noiseFrequency: 1.2,
    noiseOctaves: 7,
    worldSize: 600,
    resolution: 200,
    fogDensity: 0.003,
  };
  context.initWorld(singleIslandConfig);
  state.player = new PlayerController(context.scene, context.camera, 'god');
  state.player.sensitivity = context.getSensitivity();
  state.player.speed = context.getSpeed();
  context.showSandboxPanel();
  context.showSpawnPanel();
}

export function toggleGodMode(context: ModeManagerContext): void {
  const { state } = context;
  if (state.gameState !== 'playing') return;
  state.godModeActive = !state.godModeActive;

  if (state.godModeActive) {
    state.playController?.releasePointerLock();
    const currentPos = state.playController
      ? state.playController.getState().position
      : { x: context.camera.position.x, y: context.camera.position.y, z: context.camera.position.z };
    if (!state.godPlayer) {
      state.godPlayer = new PlayerController(context.scene, context.camera, 'god');
      state.godPlayer.sensitivity = context.getSensitivity();
      state.godPlayer.speed = context.getSpeed();
    }
    context.camera.position.set(currentPos.x, currentPos.y + 15, currentPos.z + 10);
    state.godPlayer.requestPointerLock();
    context.showSpawnPanel();
    context.showNotification('God Mode ON - Press Y to exit');
  } else {
    state.godPlayer?.releasePointerLock();
    context.hideSpawnPanel();
    context.disableSpawnMode();
    state.playController?.requestPointerLock();
    context.showNotification('God Mode OFF');
  }
}
