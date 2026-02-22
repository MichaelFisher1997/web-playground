import * as THREE from 'three';
import { createTerrain, sampleHeight } from './world/terrain.js';
import { createWater, updateWater }    from './world/water.js';
import { PlayerController }            from './player/controller.js';
import { NetworkSync }                 from './network/sync.js';

// ── DOM refs ──────────────────────────────────────────────────────────────────
const loadingEl     = document.getElementById('loading');
const joinScreen    = document.getElementById('join-screen');
const nameInput     = document.getElementById('name-input');
const joinBtn       = document.getElementById('join-btn');
const hud           = document.getElementById('hud');
const hudPos        = document.getElementById('hud-pos');
const hudPlayers    = document.getElementById('hud-players');
const pingDisplay   = document.getElementById('ping-display');
const notifications = document.getElementById('notifications');
const escMenu       = document.getElementById('esc-menu');

// ── Scene Setup ───────────────────────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type    = THREE.PCFSoftShadowMap;
renderer.toneMapping       = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.9;
document.getElementById('canvas-container').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog   = new THREE.FogExp2(0x8ec5d6, 0.007);
scene.background = new THREE.Color(0x6aaec8);

const camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.1, 800);
camera.position.set(0, 40, 80);

// ── Lighting ──────────────────────────────────────────────────────────────────
const ambientLight = new THREE.AmbientLight(0x99ccee, 0.5);
scene.add(ambientLight);

const sunLight = new THREE.DirectionalLight(0xffe8b0, 2.2);
sunLight.position.set(80, 120, 60);
sunLight.castShadow = true;
sunLight.shadow.mapSize.set(2048, 2048);
sunLight.shadow.camera.near   = 0.5;
sunLight.shadow.camera.far    = 400;
sunLight.shadow.camera.left   = sunLight.shadow.camera.bottom = -120;
sunLight.shadow.camera.right  = sunLight.shadow.camera.top   =  120;
sunLight.shadow.bias = -0.0005;
scene.add(sunLight);

const hemiLight = new THREE.HemisphereLight(0x87ceeb, 0x3a5220, 0.6);
scene.add(hemiLight);

// ── Sky ───────────────────────────────────────────────────────────────────────
{
  const skyGeo = new THREE.SphereGeometry(500, 16, 8);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: {
      uTop:    { value: new THREE.Color(0x2a6fad) },
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
}

// ── Terrain + Water ───────────────────────────────────────────────────────────
const terrain = createTerrain(200, 180);
scene.add(terrain);

const water = createWater(280);
scene.add(water);

function getHeight(x, z) { return sampleHeight(terrain, x, z); }

// ── Sun disk ──────────────────────────────────────────────────────────────────
{
  const sun = new THREE.Mesh(
    new THREE.SphereGeometry(4, 12, 8),
    new THREE.MeshBasicMaterial({ color: 0xfff0b0 })
  );
  sun.position.set(180, 130, 100);
  scene.add(sun);
}

// ── Clouds ────────────────────────────────────────────────────────────────────
for (let i = 0; i < 18; i++) {
  const geo = new THREE.PlaneGeometry(20 + Math.random() * 40, 8 + Math.random() * 14);
  const mat = new THREE.MeshBasicMaterial({
    color: 0xffffff, transparent: true,
    opacity: 0.45 + Math.random() * 0.25, depthWrite: false,
  });
  const cloud = new THREE.Mesh(geo, mat);
  cloud.position.set((Math.random() - 0.5) * 360, 55 + Math.random() * 35, (Math.random() - 0.5) * 360);
  cloud.rotation.x = -Math.PI / 2 + (Math.random() - 0.5) * 0.3;
  cloud.userData.speed = (Math.random() - 0.5) * 0.5;
  scene.add(cloud);
}

// ── Trees ─────────────────────────────────────────────────────────────────────
function mulberry32(a) {
  return () => {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
{
  const rng = mulberry32(42);
  for (let i = 0; i < 120; i++) {
    const angle = rng() * Math.PI * 2;
    const dist  = rng() * 55;
    const x = Math.cos(angle) * dist, z = Math.sin(angle) * dist;
    const h = getHeight(x, z);
    if (h < 1.5 || h > 16) continue;
    const trunkH = 1.2 + rng() * 0.8;
    const trunk  = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.18, trunkH, 5),
      new THREE.MeshLambertMaterial({ color: 0x5a3a1a })
    );
    trunk.position.set(x, h + trunkH / 2, z);
    scene.add(trunk);
    const layers = 2 + Math.floor(rng() * 2);
    for (let l = 0; l < layers; l++) {
      const lh = 2.0 - l * 0.4;
      const cone = new THREE.Mesh(
        new THREE.ConeGeometry((1.4 - l * 0.3) + rng() * 0.4, lh, 6),
        new THREE.MeshLambertMaterial({ color: new THREE.Color().setHSL(0.33 + rng() * 0.04, 0.6, 0.24 + rng() * 0.06) })
      );
      cone.position.set(x, h + trunkH + l * (lh * 0.55) + lh / 2, z);
      cone.rotation.y = rng() * Math.PI;
      scene.add(cone);
    }
  }
}

// ── Network + Player ──────────────────────────────────────────────────────────
let net         = null;
let player      = null;
let gameStarted = false;
let escOpen     = false;
let escRequestedWhileLocked = false;

function showNotification(text) {
  const div = document.createElement('div');
  div.className   = 'notif';
  div.textContent = text;
  notifications.appendChild(div);
  setTimeout(() => div.remove(), 3200);
}

// ── Loading → Join ────────────────────────────────────────────────────────────
setTimeout(() => {
  loadingEl.classList.add('hidden');
  joinScreen.classList.remove('hidden');
  nameInput.focus();
}, 1400);

function startGame(name) {
  joinScreen.classList.add('hidden');
  hud.classList.remove('hidden');
  gameStarted = true;

  player = new PlayerController(scene, camera);
  player.sensitivity = parseFloat(sensSlider.value);
  player.speed = parseInt(speedSlider.value, 10);

  net = new NetworkSync(scene, (id) => {
    console.log(`[Net] My ID: ${id}`);
    showNotification(`You joined as ${name}`);
  }, showNotification);
  net.connect(name);
}

joinBtn.addEventListener('click', () => {
  const name = nameInput.value.trim() || 'Sailor';
  startGame(name);
});
nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') joinBtn.click(); });

// ── ESC Menu ──────────────────────────────────────────────────────────────────
function openEsc() {
  if (!gameStarted) return;
  escOpen = true;
  escMenu.classList.add('open');
  player?.releasePointerLock();
  refreshEscPlayers();
}

function closeEsc() {
  escOpen = false;
  escMenu.classList.remove('open');
  // Re-lock after short delay so ESC keyup doesn't immediately unlock again
  setTimeout(() => player?.requestPointerLock(), 80);
}

document.addEventListener('pointerlockchange', () => {
  const isLocked = document.pointerLockElement === document.body;
  if (!isLocked && gameStarted && (escRequestedWhileLocked || !escOpen)) {
    escRequestedWhileLocked = false;
    openEsc();
  }
});

document.addEventListener('keydown', (e) => {
  if (!gameStarted) return;

  if (e.code === 'Escape') {
    const isLocked = document.pointerLockElement === document.body;
    if (isLocked) {
      escRequestedWhileLocked = true;
      return;
    }
    if (escOpen) {
      e.preventDefault();
      closeEsc();
    } else {
      e.preventDefault();
      openEsc();
    }
  }

  if (e.code === 'Tab') {
    e.preventDefault();
    escOpen ? closeEsc() : openEsc();
  }
});

// Canvas click → lock (only when menu is closed)
document.getElementById('canvas-container').addEventListener('click', () => {
  if (!escOpen && gameStarted) player?.requestPointerLock();
});

// Resume button
document.getElementById('esc-resume').addEventListener('click', closeEsc);

// Disconnect button
document.getElementById('esc-disconnect').addEventListener('click', () => {
  net?.destroy();
  location.reload();
});

// Tabs
document.querySelectorAll('.esc-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.esc-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.esc-pane').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');
    if (tab.dataset.tab === 'players') refreshEscPlayers();
  });
});

// Sensitivity slider
const sensSlider = document.getElementById('sens-slider');
const sensVal    = document.getElementById('sens-val');
sensSlider.addEventListener('input', () => {
  const v = parseFloat(sensSlider.value);
  sensVal.textContent = v.toFixed(1);
  if (player) player.sensitivity = v;
});

// Speed slider
const speedSlider = document.getElementById('speed-slider');
const speedVal    = document.getElementById('speed-val');
speedSlider.addEventListener('input', () => {
  const v = parseInt(speedSlider.value);
  speedVal.textContent = v;
  if (player) player.speed = v;
});

// FOV slider
const fovSlider = document.getElementById('fov-slider');
const fovVal    = document.getElementById('fov-val');
fovSlider.addEventListener('input', () => {
  const v = parseInt(fovSlider.value);
  fovVal.textContent = v + '°';
  camera.fov = v;
  camera.updateProjectionMatrix();
});

// Quality buttons
document.querySelectorAll('[data-quality]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('[data-quality]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, parseFloat(btn.dataset.quality)));
  });
});

// Shadow buttons
document.querySelectorAll('[data-shadow]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('[data-shadow]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    renderer.shadowMap.enabled = btn.dataset.shadow === 'on';
    scene.traverse(obj => { if (obj.material) obj.material.needsUpdate = true; });
  });
});

function refreshEscPlayers() {
  const list = document.getElementById('esc-player-list');
  if (!net || !net.myId) {
    list.innerHTML = '<div style="color:#4fc3f7;opacity:0.4;font-size:0.65rem;letter-spacing:0.2em;">NOT CONNECTED</div>';
    return;
  }
  const remotes = net.getRemotePlayers();
  let html = `<div class="esc-player-row">
    <div class="pdot" style="background:#4fc3f7"></div>
    <div class="pname">${nameInput.value.trim() || 'You'}</div>
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

// ── HUD Update ────────────────────────────────────────────────────────────────
let hudTick = 0;
function updateHUD() {
  if (!player || !net) return;
  hudTick++;

  const p = camera.position;
  hudPos.textContent = `${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}`;

  if (hudTick % 20 === 0) {
    const remotes = net.getRemotePlayers();
    let html = `<div style="color:#e0f0ff"><span class="player-dot" style="background:#4fc3f7"></span>${nameInput.value.trim() || 'You'}</div>`;
    for (const rp of remotes) {
      const hex = '#' + rp.color.toString(16).padStart(6, '0');
      html += `<div style="color:#e0f0ff"><span class="player-dot" style="background:${hex}"></span>${rp.name}</div>`;
    }
    hudPlayers.innerHTML = html;

    const ms = net.ping;
    pingDisplay.textContent = `${ms} ms`;
    pingDisplay.className   = ms < 80 ? 'ping-good hud-value' : ms < 200 ? 'ping-mid hud-value' : 'ping-bad hud-value';
  }
}

// ── Resize ────────────────────────────────────────────────────────────────────
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ── Render Loop ───────────────────────────────────────────────────────────────
const clock = new THREE.Clock();
let sendThrottle = 0;

function animate() {
  requestAnimationFrame(animate);
  const dt   = Math.min(clock.getDelta(), 0.05);
  const time = clock.getElapsedTime();

  // Clouds
  scene.children.forEach(obj => {
    if (obj.userData.speed !== undefined) {
      obj.position.x += obj.userData.speed * dt;
      if (obj.position.x >  200) obj.position.x = -200;
      if (obj.position.x < -200) obj.position.x =  200;
    }
  });

  updateWater(water, time, camera.position);

  if (gameStarted && player && !escOpen) {
    player.update(dt);

    sendThrottle += dt;
    if (sendThrottle >= 0.05) {
      sendThrottle = 0;
      net?.sendMove(player.getState().position, player.getState().rotation);
    }

    net?.interpolate();
    updateHUD();
  }

  renderer.render(scene, camera);
}

animate();
