import * as THREE from 'three';
import { type WorldConfig } from './world/generator.js';
import { updateWater, setWaterParams } from './world/water.js';
import { PlayerController } from './player/controller.js';
import { PlayModeController, type PlayControllerCallbacks } from './player/play-controller.js';
import { NetworkSync } from './network/sync.js';
import { MainMenu } from './ui/menu.js';
import { PlayMenu } from './ui/play-menu.js';
import { SandboxPanel } from './ui/sandbox-panel.js';
import { SpawnPanel } from './ui/spawn-panel.js';
import { Minimap } from './ui/minimap.js';
import { GlobalMap } from './ui/global-map.js';
import { createShip, updateShipMesh, SpawnedShip, getDeckHeightAt } from './objects/ship.js';
import { updateBuoyancy, WaterHeightFn, applyBoatInput } from './physics/buoyancy.js';
import { WorldManager } from './core/world-manager.js';
import { GameInputManager } from './input/game-input-manager.js';
import { UIRuntimeManager } from './core/ui-runtime-manager.js';
import { GameLoop } from './core/game-loop.js';

type GameState = 'menu' | 'playmenu' | 'sandbox' | 'playing' | 'paused';

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

let player: PlayerController | null = null;
let playController: PlayModeController | null = null;
let godPlayer: PlayerController | null = null;
let godModeActive: boolean = false;
let net: NetworkSync | null = null;
let mainMenu: MainMenu;
let playMenu: PlayMenu;
let sandboxPanel: SandboxPanel;
let spawnPanel: SpawnPanel;

const spawnedShips: SpawnedShip[] = [];
let drivenShip: SpawnedShip | null = null;
let deckOffset: { x: number; z: number } = { x: 0, z: 0 };

let gameState: GameState = 'menu';
let escOpen = false;
let escRequestedWhileLocked = false;
let playerName = '';
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
  gameState = 'playing';
  godModeActive = false;
  playMenu.hide();
  hud.classList.remove('hidden');
  
  const hudBars = document.getElementById('hud-bars');
  if (hudBars) hudBars.style.display = 'flex';
  
  initWorld(config, false);
  
  const spawnPos = worldManager.getRandomSpawnPosition();
  const callbacks: PlayControllerCallbacks = {
    getShipDeckHeight: (x: number, z: number): number | null => {
      let highestDeck: number | null = null;
      for (const ship of spawnedShips) {
        const deckY = getDeckHeightAt(ship, x, z);
        if (deckY !== null && (highestDeck === null || deckY > highestDeck)) {
          highestDeck = deckY;
        }
      }
      return highestDeck;
    },
    onHealthChange: (health: number) => {
      updateHealthBar(health);
    },
    onStaminaChange: (stamina: number) => {
      updateStaminaBar(stamina);
    },
    onWaterDeath: () => {
      showNotification('You fell into the water! Respawning...');
    },
    onEnterBoat: () => {
      const playerPos = playController?.getCharacterPosition();
      if (!playerPos) return;
      for (const ship of spawnedShips) {
        const deckY = getDeckHeightAt(ship, playerPos.x, playerPos.z);
        if (deckY !== null) {
          drivenShip = ship;
          deckOffset.x = 1.8;
          deckOffset.z = 0;
          const shipPos = ship.body.position;
          const shipRot = ship.body.rotation.y;
          const cos = Math.cos(shipRot);
          const sin = Math.sin(shipRot);
          const helmX = shipPos.x + deckOffset.x * cos - deckOffset.z * sin;
          const helmZ = shipPos.z + deckOffset.x * sin + deckOffset.z * cos;
          const helmY = getDeckHeightAt(ship, helmX, helmZ) ?? deckY;
          playController?.setPosition(helmX, helmY, helmZ);
          playController?.setDrivingBoat(true);
          showNotification('Driving boat! WASD to steer, E to exit');
          break;
        }
      }
    },
    onExitBoat: () => {
      if (drivenShip && playController) {
        const shipPos = drivenShip.body.position;
        const shipRot = drivenShip.body.rotation.y;
        const cos = Math.cos(shipRot);
        const sin = Math.sin(shipRot);
        const exitX = shipPos.x + deckOffset.x * cos - deckOffset.z * sin + 2;
        const exitZ = shipPos.z + deckOffset.x * sin + deckOffset.z * cos;
        const exitY = getDeckHeightAt(drivenShip, exitX, exitZ) ?? shipPos.y + 2;
        playController.setPosition(exitX, exitY, exitZ);
        playController.setDrivingBoat(false);
      }
      drivenShip = null;
      showNotification('Exited boat');
    },
    onBoatInput: (thrust: number, steering: number) => {
      if (drivenShip) {
        applyBoatInput(drivenShip.body, thrust, steering);
      }
    },
  };
  playController = new PlayModeController(scene, camera, worldManager.generator, spawnPos, callbacks);
  playController.sensitivity = parseFloat((document.getElementById('sens-slider') as HTMLInputElement).value);
  
  updateHealthBar(100);
  updateStaminaBar(100);
  
  setTimeout(() => playController?.requestPointerLock(), 100);
}

function toggleGodMode(): void {
  if (gameState !== 'playing') return;
  
  godModeActive = !godModeActive;
  
  if (godModeActive) {
    playController?.releasePointerLock();
    
    const currentPos = playController ? playController.getState().position : { x: camera.position.x, y: camera.position.y, z: camera.position.z };
    if (!godPlayer) {
      godPlayer = new PlayerController(scene, camera, 'god');
      godPlayer.sensitivity = parseFloat((document.getElementById('sens-slider') as HTMLInputElement).value);
      godPlayer.speed = parseInt((document.getElementById('speed-slider') as HTMLInputElement).value, 10);
    }
    camera.position.set(currentPos.x, currentPos.y + 15, currentPos.z + 10);
    
    godPlayer.requestPointerLock();
    spawnPanel.show();
    showNotification('God Mode ON - Press Y to exit');
  } else {
    godPlayer?.releasePointerLock();
    spawnPanel.hide();
    spawnPanel.toggleSpawnMode(false);
    playController?.requestPointerLock();
    showNotification('God Mode OFF');
  }
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

mainMenu = new MainMenu({
  onPlay: () => {},
  onPlayMenu: () => {
    gameState = 'playmenu';
    mainMenu.hide();
    playMenu.show();
  },
  onSandbox: () => {
    gameState = 'sandbox';
    mainMenu.hide();
    hud.classList.remove('hidden');
    
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
    initWorld(singleIslandConfig);
    
    player = new PlayerController(scene, camera, 'god');
    player.sensitivity = parseFloat((document.getElementById('sens-slider') as HTMLInputElement).value);
    player.speed = parseInt((document.getElementById('speed-slider') as HTMLInputElement).value, 10);
    
    sandboxPanel.show();
    spawnPanel.show();
  },
  onQuit: () => {
    mainMenu.hide();
    showNotification('Thanks for playing!');
  },
});

playMenu = new PlayMenu({
  onStart: (config) => {
    startPlayMode(config);
  },
  onBack: () => {
    gameState = 'menu';
    playMenu.hide();
    mainMenu.show();
    // Hide HUD bars when going back to menu
    const hudBars = document.getElementById('hud-bars');
    if (hudBars) hudBars.style.display = 'none';
  },
});

sandboxPanel = new SandboxPanel({
  onGenerate: (config) => {
    initWorld(config, false);
  },
  onRandomSeed: () => Math.floor(Math.random() * 1000000),
});

spawnPanel = new SpawnPanel({
  onSpawnShip: () => {
    spawnPanel.toggleSpawnMode();
  },
  onSpawnModeChange: (active) => {
    if (active) {
      player?.releasePointerLock();
      godPlayer?.releasePointerLock();
    }
  },
});

async function spawnShipAt(x: number, z: number): Promise<void> {
  const { mesh, body } = await createShip();
  const waterY = getWaterHeight(x, z, gameLoop.getElapsedTime());
  body.position.set(x, waterY + 1, z);
  body.rotation.y = Math.random() * Math.PI * 2;
  updateShipMesh(mesh, body);
  scene.add(mesh);
  spawnedShips.push({ mesh, body });
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
  if (gameState === 'menu' || gameState === 'playmenu') return;
  escOpen = true;
  escMenu.classList.add('open');
  player?.releasePointerLock();
  playController?.releasePointerLock();
  refreshEscPlayers();
}

function closeEsc(): void {
  escOpen = false;
  escMenu.classList.remove('open');
  setTimeout(() => {
    player?.requestPointerLock();
    playController?.requestPointerLock();
  }, 80);
}

const uiRuntime = new UIRuntimeManager({
  hudPos,
  hudPlayers,
  pingDisplay,
  minimapEl,
  minimap,
  globalMap,
  getNetwork: () => net,
  getPlayerName: () => playerName,
  getGameState: () => gameState,
  getGodModeActive: () => godModeActive,
  getCamera: () => camera,
  getPlayerController: () => player,
  getPlayController: () => playController,
  getGodPlayer: () => godPlayer,
  getSpawnedShips: () => spawnedShips,
  getDrivenShip: () => drivenShip,
});

const inputManager = new GameInputManager({
  getGameState: () => gameState,
  isEscOpen: () => escOpen,
  isGodModeActive: () => godModeActive,
  onOpenEsc: () => openEsc(),
  onCloseEsc: () => closeEsc(),
  onEscapeInSandbox: () => {
    if (sandboxPanel.isVisible()) sandboxPanel.hide();
    else openEsc();
  },
  onToggleGodMode: () => toggleGodMode(),
  onToggleSandboxPanel: () => sandboxPanel.toggle(),
  onToggleSpawnPanel: () => spawnPanel.toggle(),
  onToggleGlobalMap: () => {
    globalMap.toggle();
    if (globalMap.isVisible) {
      globalMap.resetPan();
      player?.releasePointerLock();
      playController?.releasePointerLock();
      godPlayer?.releasePointerLock();
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
        if (gameState === 'playing' && !godModeActive) playController?.requestPointerLock();
        else if (gameState === 'playing' && godModeActive) godPlayer?.requestPointerLock();
        else player?.requestPointerLock();
      }, 80);
    }
  },
  onGlobalMapOpened: () => {},
  onGlobalMapClosed: () => {},
  onCanvasClick: (event: MouseEvent) => {
    const canSpawn = gameState === 'sandbox' || (gameState === 'playing' && godModeActive);
    if (spawnPanel.isSpawnModeActive() && canSpawn) {
      const result = raycastWater(event);
      if (result.hit) spawnShipAt(result.x, result.z);
      return;
    }
    if (!escOpen && gameState === 'playing' && !godModeActive) {
      playController?.requestPointerLock();
    }
  },
  updateSensitivity: (value: number) => {
    if (player) player.sensitivity = value;
    if (playController) playController.sensitivity = value;
  },
  updateSpeed: (value: number) => {
    if (player) player.speed = value;
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

    if (!escOpen && gameState !== 'menu' && gameState !== 'playmenu') {
      if (gameState === 'playing') {
        if (godModeActive && godPlayer) {
          godPlayer.update(dt);
        } else if (playController) {
          playController.update(dt);
        }
      } else if (player) {
        player.update(dt);
      }

      if (gameState === 'playing' && net && playController && !godModeActive) {
        sendThrottle += dt;
        if (sendThrottle >= 0.05) {
          sendThrottle = 0;
          const state = playController.getState();
          net.sendMove(state.position, state.rotation);
        }
        net.interpolate();
      }

      for (const ship of spawnedShips) {
        updateBuoyancy(ship.body, getWaterHeight, time, dt);
        updateShipMesh(ship.mesh, ship.body);
      }

      if (drivenShip && playController && playController.isDrivingBoat()) {
        const shipPos = drivenShip.body.position;
        const shipRot = drivenShip.body.rotation.y;
        const cos = Math.cos(shipRot);
        const sin = Math.sin(shipRot);
        const anchorX = shipPos.x + deckOffset.x * cos - deckOffset.z * sin;
        const anchorZ = shipPos.z + deckOffset.x * sin + deckOffset.z * cos;
        const anchorY = getDeckHeightAt(drivenShip, anchorX, anchorZ) ?? (shipPos.y + 1.5);
        playController.attachToShip(shipPos, shipRot, deckOffset, anchorY);
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
