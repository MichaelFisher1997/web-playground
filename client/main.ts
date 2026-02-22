import * as THREE from 'three';
import { WorldGenerator, DEFAULT_CONFIG, WorldConfig } from './world/generator.js';
import { createWater, updateWater } from './world/water.js';
import { createOceanFloor } from './world/ocean-floor.js';
import { PlayerController } from './player/controller.js';
import { NetworkSync } from './network/sync.js';
import { MainMenu } from './ui/menu.js';
import { SandboxPanel } from './ui/sandbox-panel.js';

type GameState = 'menu' | 'sandbox' | 'playing' | 'paused';

const loadingEl = document.getElementById('loading')!;
const hud = document.getElementById('hud')!;
const hudPos = document.getElementById('hud-pos')!;
const hudPlayers = document.getElementById('hud-players')!;
const pingDisplay = document.getElementById('ping-display')!;
const notifications = document.getElementById('notifications')!;
const escMenu = document.getElementById('esc-menu')!;
const crosshair = document.getElementById('crosshair')!;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.9;
document.getElementById('canvas-container')!.appendChild(renderer.domElement);

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
let net: NetworkSync | null = null;
let mainMenu: MainMenu;
let sandboxPanel: SandboxPanel;

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
  }

  generator = new WorldGenerator(worldConfig);
  generator.generate();
  
  terrain = generator.createTerrain();
  scene.add(terrain);

  water = createWater({
    size: worldConfig.worldSize * 1.3,
    waterHeight: worldConfig.waterHeight,
    waveHeight: worldConfig.waveHeight,
    waveSpeed: worldConfig.waveSpeed,
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

mainMenu = new MainMenu({
  onPlay: () => {
    gameState = 'playing';
    mainMenu.hide();
    hud.classList.remove('hidden');
    initWorld();
    
    player = new PlayerController(scene, camera);
    player.sensitivity = parseFloat((document.getElementById('sens-slider') as HTMLInputElement).value);
    player.speed = parseInt((document.getElementById('speed-slider') as HTMLInputElement).value, 10);
    
    const nameInput = document.getElementById('name-input') as HTMLInputElement;
    playerName = nameInput.value.trim() || 'Explorer';
    
    net = new NetworkSync(
      scene,
      (id) => {
        console.log(`[Net] My ID: ${id}`);
        showNotification(`You joined as ${playerName}`);
      },
      showNotification
    );
    net.connect(playerName);
    
    setTimeout(() => player?.requestPointerLock(), 100);
  },
  onSandbox: () => {
    gameState = 'sandbox';
    mainMenu.hide();
    hud.classList.remove('hidden');
    initWorld();
    
    player = new PlayerController(scene, camera, 'god');
    player.sensitivity = parseFloat((document.getElementById('sens-slider') as HTMLInputElement).value);
    player.speed = parseInt((document.getElementById('speed-slider') as HTMLInputElement).value, 10);
    
    sandboxPanel.show();
  },
  onQuit: () => {
    mainMenu.hide();
    showNotification('Thanks for playing!');
  },
});

sandboxPanel = new SandboxPanel({
  onGenerate: (config) => {
    initWorld(config, false); // Don't reset position when auto-generating from sliders
  },
  onRandomSeed: () => Math.floor(Math.random() * 1000000),
});

function openEsc(): void {
  if (gameState === 'menu') return;
  escOpen = true;
  escMenu.classList.add('open');
  player?.releasePointerLock();
  refreshEscPlayers();
}

function closeEsc(): void {
  escOpen = false;
  escMenu.classList.remove('open');
  setTimeout(() => player?.requestPointerLock(), 80);
}

document.addEventListener('pointerlockchange', () => {
  if (gameState === 'sandbox') return; // God mode doesn't use pointer lock

  const isLocked = document.pointerLockElement === document.body;
  crosshair.classList.toggle('active', isLocked);
  
  if (!isLocked && gameState !== 'menu' && (escRequestedWhileLocked || !escOpen)) {
    escRequestedWhileLocked = false;
    openEsc();
  }
});

document.addEventListener('keydown', (e) => {
  if (gameState === 'menu') return;

  if (e.code === 'Escape') {
    if (gameState === 'sandbox') {
      if (sandboxPanel.isVisible()) {
        sandboxPanel.hide();
      } else {
        openEsc();
      }
      return;
    }
    
    const isLocked = document.pointerLockElement === document.body;
    if (isLocked) {
      escRequestedWhileLocked = true;
      return;
    }
    
    e.preventDefault();
    escOpen ? closeEsc() : openEsc();
  }

  if (e.code === 'KeyG' && gameState === 'sandbox') {
    sandboxPanel.toggle();
  }
});

document.getElementById('canvas-container')!.addEventListener('click', () => {
  if (!escOpen && gameState === 'playing') player?.requestPointerLock();
});

document.getElementById('esc-resume')!.addEventListener('click', closeEsc);

document.getElementById('esc-disconnect')!.addEventListener('click', () => {
  net?.destroy();
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
  if (!player) return;
  hudTick++;

  const p = camera.position;
  hudPos.textContent = `${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}`;

  if (hudTick % 20 === 0 && net) {
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
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

setTimeout(() => {
  loadingEl.classList.add('hidden');
}, 800);

const clock = new THREE.Clock();
let sendThrottle = 0;

function animate(): void {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  const time = clock.getElapsedTime();

  if (water) {
    updateWater(water, time, camera.position);
  }

  if (player && !escOpen && gameState !== 'menu') {
    player.update(dt);

    if (gameState === 'playing' && net) {
      sendThrottle += dt;
      if (sendThrottle >= 0.05) {
        sendThrottle = 0;
        const state = player.getState();
        net.sendMove(state.position, state.rotation);
      }
      net.interpolate();
    }
    
    updateHUD();
  }

  renderer.render(scene, camera);
}

animate();
