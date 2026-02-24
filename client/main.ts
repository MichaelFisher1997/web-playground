import * as THREE from 'three';
import { WorldGenerator, DEFAULT_CONFIG, WorldConfig } from './world/generator.js';
import { createWater, updateWater, setWaterParams, resizeWaterUniforms, getWaterSurfaceHeight } from './world/water.js';
import { createOceanFloor, updateOceanFloor } from './world/ocean-floor.js';
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

let generator: WorldGenerator;
let terrain: THREE.Mesh;
let water: THREE.Mesh;
let oceanFloor: THREE.Mesh | undefined;

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

function showNotification(text: string): void {
  const div = document.createElement('div');
  div.className = 'notif';
  div.textContent = text;
  notifications.appendChild(div);
  setTimeout(() => div.remove(), 3200);
}

function getRandomSpawnPosition(): { x: number; y: number; z: number } {
  const islands = generator.getIslands();
  if (islands.length === 0) {
    return { x: 0, y: 50, z: 0 };
  }
  
  const randomIsland = islands[Math.floor(Math.random() * islands.length)];
  const angle = Math.random() * Math.PI * 2;
  const dist = Math.random() * randomIsland.radius * 0.5;
  const x = randomIsland.x + Math.cos(angle) * dist;
  const z = randomIsland.z + Math.sin(angle) * dist;
  const y = generator.getHeightAt(x, z) + 2;
  
  return { x, y, z };
}

function getWaterHeight(x: number, z: number, time: number): number {
  const config = generator.config;
  return getWaterSurfaceHeight(
    x,
    z,
    time,
    config.waterHeight,
    config.waveHeight,
    config.waveSpeed,
    generator.getIslands(),
  );
}

function initWorld(config: Partial<WorldConfig> = {}, resetPosition: boolean = true): void {
  const worldConfig = { ...DEFAULT_CONFIG, ...config };
  
  if (terrain) {
    scene.remove(terrain);
    terrain.geometry.dispose();
    (terrain.material as THREE.Material).dispose();
  }
  if (water) {
    scene.remove(water);
    water.geometry.dispose();
    (water.material as THREE.Material).dispose();
  }
  if (oceanFloor) {
    scene.remove(oceanFloor);
    oceanFloor.geometry.dispose();
    (oceanFloor.material as THREE.Material).dispose();
  }

  // Update fog density
  if (scene.fog) {
    (scene.fog as THREE.FogExp2).density = worldConfig.fogDensity;
    (scene as any)._targetFogDensity = worldConfig.fogDensity;
  }

  generator = new WorldGenerator(worldConfig);
  generator.generate();
  
  terrain = generator.createTerrain();
  scene.add(terrain);

  const islands = generator.getIslands();
  water = createWater({
    size: worldConfig.worldSize * 1.3,
    waterHeight: worldConfig.waterHeight,
    waveHeight: worldConfig.waveHeight,
    waveSpeed: worldConfig.waveSpeed,
    skyColorTop:    (skyMat.uniforms.uTop.value    as THREE.Color),
    skyColorBottom: (skyMat.uniforms.uBottom.value as THREE.Color),
    islandCenters: islands.map(isl => ({ x: isl.x, z: isl.z })),
    islandRadii:   islands.map(isl => isl.radius),
  });
  scene.add(water);

  // Create ocean floor
  oceanFloor = createOceanFloor({
    size: worldConfig.worldSize * 1.5,
    depth: worldConfig.oceanDepth || -20,
  });
  scene.add(oceanFloor);

  scene.children
    .filter(obj => obj.userData.isDecoration)
    .forEach(obj => scene.remove(obj));

  addDecorations();

  if (resetPosition) {
    const spawn = generator.getSpawnPosition();
    camera.position.set(spawn.x, spawn.y + 10, spawn.z + 20);
  }

  // Bake minimap terrain texture for the new world
  minimap.bakeTexture(generator);
  globalMap.bakeTexture(generator);
  // Size the global map canvas to match its CSS container
  const gmCanvas = document.getElementById('global-map-canvas') as HTMLCanvasElement;
  if (gmCanvas) {
    const panel = document.getElementById('global-map-panel')!;
    const sz = panel.clientWidth || 600;
    gmCanvas.width  = sz;
    gmCanvas.height = sz;
  }
}

function addDecorations(): void {
  const islands = generator.getIslands();
  
  for (const island of islands) {
    const treeCount = Math.floor((island.radius / 20) * 5);
    
    for (let i = 0; i < treeCount; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = Math.random() * island.radius * 0.8;
      const x = island.x + Math.cos(angle) * dist;
      const z = island.z + Math.sin(angle) * dist;
      const h = generator.sampleHeight(x, z);
      
      if (h < 1 || h > 20) continue;
      
      const trunkH = 1.2 + Math.random() * 0.8;
      const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.12, 0.18, trunkH, 5),
        new THREE.MeshLambertMaterial({ color: 0x5a3a1a })
      );
      trunk.position.set(x, h + trunkH / 2, z);
      trunk.castShadow = true;
      trunk.userData.isDecoration = true;
      scene.add(trunk);
      
      const layers = 2 + Math.floor(Math.random() * 2);
      for (let l = 0; l < layers; l++) {
        const lh = 2.0 - l * 0.4;
        const cone = new THREE.Mesh(
          new THREE.ConeGeometry((1.4 - l * 0.3) + Math.random() * 0.4, lh, 6),
          new THREE.MeshLambertMaterial({ 
            color: new THREE.Color().setHSL(0.33 + Math.random() * 0.04, 0.6, 0.24 + Math.random() * 0.06) 
          })
        );
        cone.position.set(x, h + trunkH + l * (lh * 0.55) + lh / 2, z);
        cone.rotation.y = Math.random() * Math.PI;
        cone.castShadow = true;
        cone.userData.isDecoration = true;
        scene.add(cone);
      }
    }
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
  
  const spawnPos = getRandomSpawnPosition();
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
  playController = new PlayModeController(scene, camera, generator, spawnPos, callbacks);
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
  const waterY = getWaterHeight(x, z, clock.getElapsedTime());
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

  const waterPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -generator.config.waterHeight);
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

document.addEventListener('pointerlockchange', () => {
  if (gameState === 'sandbox') return;

  const isLocked = document.pointerLockElement === document.body;
  crosshair.classList.toggle('active', isLocked);
});

document.addEventListener('keydown', (e) => {
  if (gameState === 'menu' || gameState === 'playmenu') return;

  if (e.code === 'Escape') {
    if (gameState === 'sandbox') {
      if (sandboxPanel.isVisible()) {
        sandboxPanel.hide();
      } else {
        openEsc();
      }
      return;
    }
    
    if (godModeActive && gameState === 'playing') {
      toggleGodMode();
      return;
    }
    
    const isLocked = document.pointerLockElement === document.body;
    if (isLocked) {
      e.preventDefault();
      openEsc();
      return;
    }
    
    e.preventDefault();
    escOpen ? closeEsc() : openEsc();
    return;
  }

  if (e.code === 'KeyG' && gameState === 'sandbox') {
    sandboxPanel.toggle();
    return;
  }

  if (e.code === 'KeyY') {
    if (gameState === 'playing') {
      e.preventDefault();
      e.stopPropagation();
      toggleGodMode();
    }
    return;
  }

  if (e.code === 'KeyP') {
    if (gameState === 'sandbox' || (gameState === 'playing' && godModeActive)) {
      spawnPanel.toggle();
    }
  }

  if (e.code === 'KeyM') {
    if (gameState === 'playing' || gameState === 'sandbox') {
      e.preventDefault();
        globalMap.toggle();
      if (globalMap.isVisible) {
        globalMap.resetPan();
        // Release pointer lock so mouse can interact with the map
        player?.releasePointerLock();
        playController?.releasePointerLock();
        godPlayer?.releasePointerLock();
        // Resize canvas and draw immediately
        const gmCanvas = document.getElementById('global-map-canvas') as HTMLCanvasElement;
        const panel    = document.getElementById('global-map-panel')!;
        const sz = panel.clientWidth;
        if (sz > 0) { gmCanvas.width = sz; gmCanvas.height = sz; }
        _redrawGlobalMap();
      } else {
        // Re-lock on close
        setTimeout(() => {
          if (gameState === 'playing' && !godModeActive) playController?.requestPointerLock();
          else if (gameState === 'playing' && godModeActive) godPlayer?.requestPointerLock();
          else player?.requestPointerLock();
        }, 80);
      }
    }
  }
}, true);

document.getElementById('canvas-container')!.addEventListener('click', (e) => {
  const canSpawn = (gameState === 'sandbox') || (gameState === 'playing' && godModeActive);
  if (spawnPanel.isSpawnModeActive() && canSpawn) {
    const result = raycastWater(e as MouseEvent);
    if (result.hit) {
      spawnShipAt(result.x, result.z);
    }
    return;
  }
  if (!escOpen && gameState === 'playing' && !godModeActive) {
    playController?.requestPointerLock();
  }
});

document.getElementById('esc-resume')!.addEventListener('click', closeEsc);

document.getElementById('esc-disconnect')!.addEventListener('click', () => {
  location.reload();
});

document.querySelectorAll('.esc-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.esc-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.esc-pane').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    const pane = document.getElementById(`tab-${(tab as HTMLElement).dataset.tab}`);
    pane?.classList.add('active');
    if ((tab as HTMLElement).dataset.tab === 'players') refreshEscPlayers();
  });
});

const sensSlider = document.getElementById('sens-slider') as HTMLInputElement;
const sensVal = document.getElementById('sens-val')!;
sensSlider.addEventListener('input', () => {
  const v = parseFloat(sensSlider.value);
  sensVal.textContent = v.toFixed(1);
  if (player) player.sensitivity = v;
  if (playController) playController.sensitivity = v;
});

const speedSlider = document.getElementById('speed-slider') as HTMLInputElement;
const speedVal = document.getElementById('speed-val')!;
speedSlider.addEventListener('input', () => {
  const v = parseInt(speedSlider.value, 10);
  speedVal.textContent = String(v);
  if (player) player.speed = v;
});

const fovSlider = document.getElementById('fov-slider') as HTMLInputElement;
const fovVal = document.getElementById('fov-val')!;
fovSlider.addEventListener('input', () => {
  const v = parseInt(fovSlider.value, 10);
  fovVal.textContent = `${v}°`;
  camera.fov = v;
  camera.updateProjectionMatrix();
});

document.querySelectorAll('[data-quality]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('[data-quality]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, parseFloat((btn as HTMLElement).dataset.quality!)));
  });
});

document.querySelectorAll('[data-shadow]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('[data-shadow]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    renderer.shadowMap.enabled = (btn as HTMLElement).dataset.shadow === 'on';
    scene.traverse(obj => { 
      if (obj instanceof THREE.Mesh && obj.material) {
        (obj.material as THREE.Material).needsUpdate = true;
      }
    });
  });
});

function refreshEscPlayers(): void {
  const list = document.getElementById('esc-player-list')!;
  if (!net || !net.myId) {
    list.innerHTML = '<div style="color:#4fc3f7;opacity:0.4;font-size:0.65rem;letter-spacing:0.2em;">NOT CONNECTED</div>';
    return;
  }
  const remotes = net.getRemotePlayers();
  let html = `<div class="esc-player-row">
    <div class="pdot" style="background:#4fc3f7"></div>
    <div class="pname">${playerName || 'You'}</div>
    <div class="pyou">you</div>
  </div>`;
  for (const rp of remotes) {
    const hex = '#' + rp.color.toString(16).padStart(6, '0');
    html += `<div class="esc-player-row">
      <div class="pdot" style="background:${hex}"></div>
      <div class="pname">${rp.name}</div>
    </div>`;
  }
  if (remotes.length === 0) {
    html += `<div style="color:#4fc3f7;opacity:0.3;font-size:0.62rem;letter-spacing:0.15em;padding:8px 0;">No other players online</div>`;
  }
  list.innerHTML = html;
}

let hudTick = 0;
function updateHUD(): void {
  if (gameState === 'playing') {
    if (godModeActive) {
      const p = camera.position;
      hudPos.textContent = `${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)} [GOD]`;
    } else if (playController) {
      const state = playController.getState();
      hudPos.textContent = `${state.position.x.toFixed(1)}, ${state.position.y.toFixed(1)}, ${state.position.z.toFixed(1)}`;
    }
  } else if (player) {
    const p = camera.position;
    hudPos.textContent = `${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}`;
  }

  if (hudTick % 20 === 0 && net && gameState !== 'playing') {
    const remotes = net.getRemotePlayers();
    let html = `<div style="color:#e0f0ff"><span class="player-dot" style="background:#4fc3f7"></span>${playerName || 'You'}</div>`;
    for (const rp of remotes) {
      const hex = '#' + rp.color.toString(16).padStart(6, '0');
      html += `<div style="color:#e0f0ff"><span class="player-dot" style="background:${hex}"></span>${rp.name}</div>`;
    }
    hudPlayers.innerHTML = html;

    const ms = net.ping;
    pingDisplay.textContent = `${ms} ms`;
    pingDisplay.className = ms < 80 ? 'ping-good hud-value' : ms < 200 ? 'ping-mid hud-value' : 'ping-bad hud-value';
  }
  
  hudTick++;
}

function _redrawGlobalMap(): void {
  if (!globalMap.isVisible) return;
  const playerPos = playController?.getCharacterPosition()
    ?? (player ? camera.position : null)
    ?? camera.position;
  const playerYaw = godModeActive
    ? (godPlayer?.yaw ?? 0)
    : playController
      ? playController.yaw
      : (player?.yaw ?? 0);
  const remotes = (net && gameState === 'playing') ? net.getRemotePlayers() : [];
  globalMap.draw(
    playerPos.x,
    playerPos.z,
    playerYaw,
    spawnedShips,
    drivenShip,
    remotes,
  );
}

function updateMinimap(): void {
  if (!minimapEl) return;

  const show = gameState === 'playing' || gameState === 'sandbox';
  minimapEl.classList.toggle('hidden', !show);

  if (!show) return;

  const playerPos = playController?.getCharacterPosition()
    ?? (player ? camera.position : null)
    ?? camera.position;

  // Derive yaw from the active controller (yaw=0 → looking toward -Z / north)
  const playerYaw = godModeActive
    ? (godPlayer?.yaw ?? 0)
    : playController
      ? playController.yaw
      : (player?.yaw ?? 0);

  const remotes = (net && gameState === 'playing') ? net.getRemotePlayers() : [];

  minimap.update(
    playerPos.x,
    playerPos.z,
    playerYaw,
    spawnedShips,
    drivenShip,
    remotes,
  );
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  // Resize depth render target
  depthRT.dispose();
  depthRT = makeDepthRT(window.innerWidth, window.innerHeight);
  if (water) resizeWaterUniforms(water, window.innerWidth, window.innerHeight);
});

setTimeout(() => {
  loadingEl.classList.add('hidden');
}, 800);

const clock = new THREE.Clock();
let sendThrottle = 0;

// Reusable sun direction vector (world-space, normalised)
const _sunDir = new THREE.Vector3();

// Fog colours for above/below water transitions
const _fogColorAbove = new THREE.Color(0x8ec5d6);
const _fogColorUnder = new THREE.Color(0x062d52);

function animate(): void {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  const time = clock.getElapsedTime();

  // Compute current sun direction from scene light position
  _sunDir.copy(sunLight.position).normalize();

  // ---- Depth pre-pass (render scene without water into depthRT) ----
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

  if (oceanFloor) {
    updateOceanFloor(oceanFloor, time, _sunDir);
  }

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

  renderer.render(scene, camera);
}

animate();
