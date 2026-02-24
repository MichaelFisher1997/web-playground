import * as THREE from 'three';
import { type WorldConfig } from './world/generator.js';
import { updateWater, setWaterParams } from './world/water.js';
import { PlayerController } from './player/controller.js';
import { PlayModeController } from './player/play-controller.js';
import { NetworkSync } from './network/sync.js';
import { MainMenu } from './ui/menu.js';
import { PlayMenu } from './ui/play-menu.js';
import { SandboxPanel } from './ui/sandbox-panel.js';
import { SpawnPanel } from './ui/spawn-panel.js';
import { Minimap } from './ui/minimap.js';
import { GlobalMap } from './ui/global-map.js';
import { SpawnedShip } from './objects/ship.js';
import { WorldManager } from './core/world-manager.js';
import { GameInputManager } from './input/game-input-manager.js';
import { UIRuntimeManager } from './core/ui-runtime-manager.js';
import { GameLoop } from './core/game-loop.js';
import { ModeManager } from './core/mode-manager.js';
import { ShipSystem } from './systems/ship-system.js';

type GameState = 'menu' | 'playmenu' | 'sandbox' | 'playing' | 'paused';

interface RuntimeState {
  player: PlayerController | null;
  playController: PlayModeController | null;
  godPlayer: PlayerController | null;
  net: NetworkSync | null;
  mainMenu: MainMenu | null;
  playMenu: PlayMenu | null;
  sandboxPanel: SandboxPanel | null;
  spawnPanel: SpawnPanel | null;
  gameState: GameState;
  godModeActive: boolean;
  escOpen: boolean;
  playerName: string;
}

const loadingEl = document.getElementById('loading')!;
const hud = document.getElementById('hud')!;
const hudPos = document.getElementById('hud-pos')!;
const hudPlayers = document.getElementById('hud-players')!;
const pingDisplay = document.getElementById('ping-display')!;
const notifications = document.getElementById('notifications')!;
const escMenu = document.getElementById('esc-menu')!;
const crosshair = document.getElementById('crosshair')!;
const minimapEl = document.getElementById('minimap')!;
const minimapCanvas = document.getElementById('minimap-canvas') as HTMLCanvasElement;

const MINIMAP_RANGE = 200;

const minimap = new Minimap({ canvas: minimapCanvas, range: MINIMAP_RANGE });
const globalMap = new GlobalMap();

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.9;
document.getElementById('canvas-container')!.appendChild(renderer.domElement);

// ---- Depth pre-pass render target ----
// We render the scene (water hidden) into this, then give the depth+colour
// textures to the water shader so it can compute real underwater transparency.
function makeDepthRT(w: number, h: number): THREE.WebGLRenderTarget {
  const depthTex = new THREE.DepthTexture(w, h);
  depthTex.type = THREE.UnsignedIntType;
  const rt = new THREE.WebGLRenderTarget(w, h, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthTexture: depthTex,
  });
  return rt;
}
let depthRT = makeDepthRT(window.innerWidth, window.innerHeight);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x8ec5d6, 0.004);
scene.background = new THREE.Color(0x6aaec8);

const camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.1, 1500);
camera.position.set(0, 80, 120);

const ambientLight = new THREE.AmbientLight(0x99ccee, 0.5);
scene.add(ambientLight);

const sunLight = new THREE.DirectionalLight(0xffe8b0, 2.2);
sunLight.position.set(80, 120, 60);
sunLight.castShadow = true;
sunLight.shadow.mapSize.set(2048, 2048);
sunLight.shadow.camera.near = 0.5;
sunLight.shadow.camera.far = 400;
sunLight.shadow.camera.left = sunLight.shadow.camera.bottom = -150;
sunLight.shadow.camera.right = sunLight.shadow.camera.top = 150;
sunLight.shadow.bias = -0.0005;
scene.add(sunLight);

const hemiLight = new THREE.HemisphereLight(0x87ceeb, 0x3a5220, 0.6);
scene.add(hemiLight);

const skyGeo = new THREE.SphereGeometry(700, 16, 8);
const skyMat = new THREE.ShaderMaterial({
  side: THREE.BackSide,
  uniforms: {
    uTop: { value: new THREE.Color(0x2a6fad) },
    uBottom: { value: new THREE.Color(0x8ec5d6) },
  },
  vertexShader: `
    varying float vY;
    void main() {
      vY = normalize(position).y;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform vec3 uTop, uBottom;
    varying float vY;
    void main() {
      float t = smoothstep(-0.1, 0.6, vY);
      gl_FragColor = vec4(mix(uBottom, uTop, t), 1.0);
    }
  `,
});
scene.add(new THREE.Mesh(skyGeo, skyMat));

const sun = new THREE.Mesh(
  new THREE.SphereGeometry(8, 12, 8),
  new THREE.MeshBasicMaterial({ color: 0xfff0b0 })
);
sun.position.set(200, 150, 150);
scene.add(sun);

const worldManager = new WorldManager(scene, camera, skyMat, minimap, globalMap);

const state: RuntimeState = {
  player: null,
  playController: null,
  godPlayer: null,
  net: null,
  mainMenu: null,
  playMenu: null,
  sandboxPanel: null,
  spawnPanel: null,
  gameState: 'menu',
  godModeActive: false,
  escOpen: false,
  playerName: '',
};

let gameLoop: GameLoop;

function showNotification(text: string): void {
  const div = document.createElement('div');
  div.className = 'notif';
  div.textContent = text;
  notifications.appendChild(div);
  setTimeout(() => div.remove(), 3200);
}

function getWaterHeight(x: number, z: number, time: number): number {
  return worldManager.getWaterHeight(x, z, time);
}

const shipSystem = new ShipSystem(scene, getWaterHeight);
let modeManager: ModeManager;

function initWorld(config: Partial<WorldConfig> = {}, resetPosition: boolean = true): void {
  worldManager.initWorld(config, resetPosition);
  const gmCanvas = document.getElementById('global-map-canvas') as HTMLCanvasElement;
  if (gmCanvas) {
    const panel = document.getElementById('global-map-panel')!;
    const sz = panel.clientWidth || 600;
    gmCanvas.width  = sz;
    gmCanvas.height = sz;
  }
}

function startPlayMode(config: WorldConfig): void {
  modeManager.startPlayMode(config);
}

function toggleGodMode(): void {
  modeManager.toggleGodMode();
}

function updateHealthBar(health: number): void {
  const healthFill = document.getElementById('health-fill');
  const healthText = document.getElementById('health-text');
  if (healthFill) {
    healthFill.style.width = `${health}%`;
    healthFill.style.background = health > 60 ? '#4ade80' : health > 30 ? '#fbbf24' : '#ef4444';
  }
  if (healthText) {
    healthText.textContent = `${Math.round(health)}`;
  }
}

function updateStaminaBar(stamina: number): void {
  const staminaFill = document.getElementById('stamina-fill');
  const staminaText = document.getElementById('stamina-text');
  if (staminaFill) {
    staminaFill.style.width = `${stamina}%`;
  }
  if (staminaText) {
    staminaText.textContent = `${Math.round(stamina)}`;
  }
}

modeManager = new ModeManager({
  state,
  scene,
  camera,
  hud,
  worldManager,
  shipSystem,
  initWorld,
  hidePlayMenu: () => state.playMenu?.hide(),
  showSpawnPanel: () => state.spawnPanel?.show(),
  hideSpawnPanel: () => state.spawnPanel?.hide(),
  disableSpawnMode: () => state.spawnPanel?.toggleSpawnMode(false),
  showSandboxPanel: () => state.sandboxPanel?.show(),
  showNotification,
  updateHealthBar,
  updateStaminaBar,
  getSensitivity: () => parseFloat((document.getElementById('sens-slider') as HTMLInputElement).value),
  getSpeed: () => parseInt((document.getElementById('speed-slider') as HTMLInputElement).value, 10),
});

state.mainMenu = new MainMenu({
  onPlay: () => {},
  onPlayMenu: () => {
    state.gameState = 'playmenu';
    state.mainMenu?.hide();
    state.playMenu?.show();
  },
  onSandbox: () => {
    state.mainMenu?.hide();
    modeManager.startSandboxMode();
  },
  onQuit: () => {
    state.mainMenu?.hide();
    showNotification('Thanks for playing!');
  },
});

state.playMenu = new PlayMenu({
  onStart: (config) => {
    startPlayMode(config);
  },
  onBack: () => {
    state.gameState = 'menu';
    state.playMenu?.hide();
    state.mainMenu?.show();
    // Hide HUD bars when going back to menu
    const hudBars = document.getElementById('hud-bars');
    if (hudBars) hudBars.style.display = 'none';
  },
});

state.sandboxPanel = new SandboxPanel({
  onGenerate: (config) => {
    initWorld(config, false);
  },
  onRandomSeed: () => Math.floor(Math.random() * 1000000),
});

state.spawnPanel = new SpawnPanel({
  onSpawnShip: () => {
    state.spawnPanel?.toggleSpawnMode();
  },
  onSpawnModeChange: (active) => {
    if (active) {
      state.player?.releasePointerLock();
      state.godPlayer?.releasePointerLock();
    }
  },
});

async function spawnShipAt(x: number, z: number): Promise<void> {
  await shipSystem.spawnShipAt(x, z, gameLoop.getElapsedTime());
  showNotification('Ship spawned! Click to place more.');
}

function raycastWater(event: MouseEvent): { hit: boolean; x: number; z: number } {
  const rect = renderer.domElement.getBoundingClientRect();
  const mouse = new THREE.Vector2(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1
  );

  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(mouse, camera);

  const waterPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -worldManager.generator.config.waterHeight);
  const intersection = new THREE.Vector3();
  raycaster.ray.intersectPlane(waterPlane, intersection);

  if (intersection) {
    return { hit: true, x: intersection.x, z: intersection.z };
  }
  return { hit: false, x: 0, z: 0 };
}

function openEsc(): void {
  if (state.gameState === 'menu' || state.gameState === 'playmenu') return;
  state.escOpen = true;
  escMenu.classList.add('open');
  state.player?.releasePointerLock();
  state.playController?.releasePointerLock();
  refreshEscPlayers();
}

function closeEsc(): void {
  state.escOpen = false;
  escMenu.classList.remove('open');
  setTimeout(() => {
    state.player?.requestPointerLock();
    state.playController?.requestPointerLock();
  }, 80);
}

const uiRuntime = new UIRuntimeManager({
  hudPos,
  hudPlayers,
  pingDisplay,
  minimapEl,
  minimap,
  globalMap,
  getNetwork: () => state.net,
  getPlayerName: () => state.playerName,
  getGameState: () => state.gameState,
  getGodModeActive: () => state.godModeActive,
  getCamera: () => camera,
  getPlayerController: () => state.player,
  getPlayController: () => state.playController,
  getGodPlayer: () => state.godPlayer,
  getSpawnedShips: () => shipSystem.getShips(),
  getDrivenShip: () => shipSystem.getDrivenShip(),
});

const inputManager = new GameInputManager({
  getGameState: () => state.gameState,
  isEscOpen: () => state.escOpen,
  isGodModeActive: () => state.godModeActive,
  onOpenEsc: () => openEsc(),
  onCloseEsc: () => closeEsc(),
  onEscapeInSandbox: () => {
    if (state.sandboxPanel?.isVisible()) state.sandboxPanel.hide();
    else openEsc();
  },
  onToggleGodMode: () => toggleGodMode(),
  onToggleSandboxPanel: () => state.sandboxPanel?.toggle(),
  onToggleSpawnPanel: () => state.spawnPanel?.toggle(),
  onToggleGlobalMap: () => {
    globalMap.toggle();
    if (globalMap.isVisible) {
      globalMap.resetPan();
      state.player?.releasePointerLock();
      state.playController?.releasePointerLock();
      state.godPlayer?.releasePointerLock();
      const gmCanvas = document.getElementById('global-map-canvas') as HTMLCanvasElement;
      const panel = document.getElementById('global-map-panel')!;
      const sz = panel.clientWidth;
      if (sz > 0) {
        gmCanvas.width = sz;
        gmCanvas.height = sz;
      }
      _redrawGlobalMap();
    } else {
      setTimeout(() => {
        if (state.gameState === 'playing' && !state.godModeActive) state.playController?.requestPointerLock();
        else if (state.gameState === 'playing' && state.godModeActive) state.godPlayer?.requestPointerLock();
        else state.player?.requestPointerLock();
      }, 80);
    }
  },
  onGlobalMapOpened: () => {},
  onGlobalMapClosed: () => {},
  onCanvasClick: (event: MouseEvent) => {
    const canSpawn = state.gameState === 'sandbox' || (state.gameState === 'playing' && state.godModeActive);
    if (state.spawnPanel?.isSpawnModeActive() && canSpawn) {
      const result = raycastWater(event);
      if (result.hit) spawnShipAt(result.x, result.z);
      return;
    }
    if (!state.escOpen && state.gameState === 'playing' && !state.godModeActive) {
      state.playController?.requestPointerLock();
    }
  },
  updateSensitivity: (value: number) => {
    if (state.player) state.player.sensitivity = value;
    if (state.playController) state.playController.sensitivity = value;
  },
  updateSpeed: (value: number) => {
    if (state.player) state.player.speed = value;
  },
  updateFov: (value: number) => {
    camera.fov = value;
    camera.updateProjectionMatrix();
  },
  updateQuality: (value: number) => {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, value));
  },
  updateShadows: (enabled: boolean) => {
    renderer.shadowMap.enabled = enabled;
    scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh && obj.material) {
        (obj.material as THREE.Material).needsUpdate = true;
      }
    });
  },
  onPointerLockChange: (isLocked: boolean) => {
    crosshair.classList.toggle('active', isLocked);
  },
  onEscTabPlayers: () => refreshEscPlayers(),
});
inputManager.bind(renderer);

function refreshEscPlayers(): void {
  uiRuntime.refreshEscPlayers();
}

function updateHUD(): void {
  uiRuntime.updateHUD();
}

function _redrawGlobalMap(): void {
  uiRuntime.redrawGlobalMap();
}

function updateMinimap(): void {
  uiRuntime.updateMinimap();
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  // Resize depth render target
  depthRT.dispose();
  depthRT = makeDepthRT(window.innerWidth, window.innerHeight);
  worldManager.resize(window.innerWidth, window.innerHeight);
});

setTimeout(() => {
  loadingEl.classList.add('hidden');
}, 800);

let sendThrottle = 0;

// Reusable sun direction vector (world-space, normalised)
const _sunDir = new THREE.Vector3();

// Fog colours for above/below water transitions
const _fogColorAbove = new THREE.Color(0x8ec5d6);
const _fogColorUnder = new THREE.Color(0x062d52);

gameLoop = new GameLoop({
  update: (dt: number, time: number) => {
  // Compute current sun direction from scene light position
    _sunDir.copy(sunLight.position).normalize();

  // ---- Depth pre-pass (render scene without water into depthRT) ----
    const water = worldManager.water;
    if (water) {
      water.visible = false;
      renderer.setRenderTarget(depthRT);
      renderer.render(scene, camera);
      renderer.setRenderTarget(null);
      water.visible = true;

      updateWater(
        water, time, camera.position, _sunDir,
        depthRT.depthTexture,
        depthRT.texture,
        camera,
      );
    }

    worldManager.updateOceanFloor(time, _sunDir);

  // --- Underwater atmosphere ---
    if (scene.fog && water) {
      const waterY = water.position.y;
      const isUnder = camera.position.y < waterY;
      const fog = scene.fog as THREE.FogExp2;
      if (isUnder) {
        fog.color.lerp(_fogColorUnder, 0.12);
        fog.density = Math.min(fog.density + 0.002, 0.045);
        scene.background = fog.color;
      } else {
        fog.color.lerp(_fogColorAbove, 0.12);
        const targetDensity = (scene as any)._targetFogDensity ?? 0.004;
        fog.density = fog.density + (targetDensity - fog.density) * 0.08;
        scene.background = new THREE.Color(0x6aaec8);
      }
    }

    if (!state.escOpen && state.gameState !== 'menu' && state.gameState !== 'playmenu') {
      if (state.gameState === 'playing') {
        if (state.godModeActive && state.godPlayer) {
          state.godPlayer.update(dt);
        } else if (state.playController) {
          state.playController.update(dt);
        }
      } else if (state.player) {
        state.player.update(dt);
      }

      if (state.gameState === 'playing' && state.net && state.playController && !state.godModeActive) {
        sendThrottle += dt;
        if (sendThrottle >= 0.05) {
          sendThrottle = 0;
          const playState = state.playController.getState();
          state.net.sendMove(playState.position, playState.rotation);
        }
        state.net.interpolate();
      }

      shipSystem.update(time, dt);

      if (state.playController) {
        shipSystem.attachDrivenPlayer(state.playController);
      }

      updateHUD();
      updateMinimap();
      _redrawGlobalMap();
    }
  },
  render: () => {
    renderer.render(scene, camera);
  },
});

gameLoop.start();
