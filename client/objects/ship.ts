import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { BuoyantBody } from '../physics/buoyancy.js';

const SHIP_DEBUG_VISUALS = true;
const DEBUG_MIN_ARROW = 0.001;

// ── GLB coordinate system ────────────────────────────────────────────────────
// Measured from GLB (after node scale×100 baked in):
//   Bow at GLB +Z (~3.76), stern at GLB -Z (~-0.09)
//   Keel at GLB Y=-3.89, hull rim at GLB Y=+2.45
//   Ship width along GLB X: ±0.575
//
// model.rotation.y = +PI/2  →  GLB (x,y,z) maps to group (z*S, y*S+OY, -x*S)
//   so bow (+Z) ends up at group +X  (engine "forward" direction)
//
// model.scale = MODEL_SCALE applied before rotation (Three.js TRS order).
// model.position.y = MODEL_Y_OFFSET shifts group Y so waterline sits at body.y.

const MODEL_SCALE  = 3.5;
const GLB_KEEL_Y   = -3.890;
const GLB_LEN      =  6.061;   // Z extent
const GLB_WIDTH    =  1.150;   // X extent (±0.575)

// Buoyancy: equilibrium at body.y = waterY + BODY_HEIGHT*0.3
// We want GLB Y=0 (natural waterline) to be at waterY, so:
//   body.y + MODEL_Y_OFFSET = waterY  →  MODEL_Y_OFFSET = -BODY_HEIGHT*0.3
const BODY_HEIGHT    = Math.abs(GLB_KEEL_Y) * MODEL_SCALE;   // 13.615
const MODEL_Y_OFFSET = -(BODY_HEIGHT * 0.3);                  // -4.085

// Helper: GLB Y → group Y (relative to body.position.y)
const glbY = (y: number) => y * MODEL_SCALE + MODEL_Y_OFFSET;
// Helper: GLB Z → group X (bow = +X)
const glbZ = (z: number) => z * MODEL_SCALE;
// Helper: GLB X → group Z (width)
const glbX = (x: number) => -x * MODEL_SCALE;

// ── Deck sections (group-local, relative to body.position.y) ────────────────
// Three walkable levels derived from GLB geometry:
//
//  1. MAIN DECK — open middle section, GLB Y≈0.30, Z: 1.38→2.87
//     group X: 4.83→10.05  group Y: -3.04
//
//  2. STERN QUARTER DECK — raised aft platform, GLB Y≈0.40, Z: -0.09→1.38
//     group X: -0.32→4.83  group Y: -2.69  (slightly raised)
//
//  3. FORECASTLE DECK — raised bow platform, GLB Y≈1.65, Z: 2.87→3.76
//     group X: 10.05→13.16  group Y: +1.69  (significantly raised)
//
// All group Z centred at 0 (width ±2.01 = GLB X ±0.575 * SCALE)

interface DeckSection {
  // group-local box centre (relative to ship group origin = body.position)
  cx: number;  // along ship length (bow = +X)
  cy: number;  // deck surface Y
  cz: number;  // across ship width
  halfL: number;  // half-length along X
  halfW: number;  // half-width along Z
  name: string;
}

function buildDeckSectionsFromModel(model: THREE.Group): DeckSection[] {
  const bounds = new THREE.Box3().setFromObject(model);
  const minX = bounds.min.x;
  const maxX = bounds.max.x;
  const minZ = bounds.min.z;
  const maxZ = bounds.max.z;

  const length = Math.max(1, maxX - minX);
  const width = Math.max(0.8, maxZ - minZ);
  const sternEnd = minX + length * 0.36;
  const foreStart = minX + length * 0.76;

  const mainY = glbY(0.30);
  const sternY = glbY(0.45);

  return [
    {
      name: 'stern',
      cx: (minX + sternEnd) * 0.5,
      cy: sternY,
      cz: (minZ + maxZ) * 0.5,
      halfL: Math.max(1.2, (sternEnd - minX) * 0.5),
      halfW: width * 0.42,
    },
    {
      name: 'main',
      cx: (sternEnd + foreStart) * 0.5,
      cy: mainY,
      cz: (minZ + maxZ) * 0.5,
      halfL: Math.max(1.2, (foreStart - sternEnd) * 0.5),
      halfW: width * 0.44,
    },
    {
      name: 'forecastle',
      cx: (foreStart + maxX) * 0.5,
      cy: mainY,
      cz: (minZ + maxZ) * 0.5,
      halfL: Math.max(0.9, (maxX - foreStart) * 0.5),
      halfW: width * 0.40,
    },
  ];
}

const DECK_HALF_W = (GLB_WIDTH / 2) * MODEL_SCALE;  // 2.01

export const DECK_SECTIONS: DeckSection[] = [
  {
    name: 'stern',
    cx: 2.25,
    cy: glbY(0.30),
    cz: 0,
    halfL: 2.85,
    halfW: 2.2,
  },
  {
    name: 'main',
    cx: 7.35,
    cy: glbY(0.30),
    cz: 0,
    halfL: 2.95,
    halfW: 2.2,
  },
  {
    name: 'forecastle',
    cx: 11.55,
    cy: glbY(0.30),
    cz: 0,
    halfL: 1.95,
    halfW: 2.15,
  },
];

// For backwards compat with getDeckHeightAt — lowest/most common deck
export const SHIP_DECK_HEIGHT = DECK_SECTIONS.find((d) => d.name === 'main')!.cy;

// Physics body dims
export const SHIP_HULL_LENGTH = GLB_LEN   * MODEL_SCALE;   // 21.2
export const SHIP_HULL_WIDTH  = GLB_WIDTH * MODEL_SCALE;   //  4.03
export const SHIP_HULL_HEIGHT = BODY_HEIGHT;               // 13.62

// ── GLTFLoader singleton ─────────────────────────────────────────────────────
const _loader = new GLTFLoader();
let _loadPromise: Promise<THREE.Group> | null = null;

function loadGlb(): Promise<THREE.Group> {
  if (_loadPromise) return _loadPromise;
  _loadPromise = new Promise((resolve, reject) => {
    _loader.load(
      '/Sail_Ship.glb',
      (gltf) => {
        const root = gltf.scene as THREE.Group;
        root.traverse((obj) => {
          if (obj instanceof THREE.Mesh) {
            obj.castShadow    = true;
            obj.receiveShadow = true;
          }
        });
        resolve(root);
      },
      undefined,
      reject,
    );
  });
  return _loadPromise;
}

loadGlb().catch(() => {});

// ── createShip ───────────────────────────────────────────────────────────────
export async function createShip(): Promise<{ mesh: THREE.Group; body: BuoyantBody }> {
  const group = new THREE.Group();
  group.name = 'ship';
  group.userData.isSpawnedObject = true;
  group.userData.isShip          = true;
  group.userData.deckHeight      = SHIP_DECK_HEIGHT;

  let model: THREE.Group;
  try {
    const root = await loadGlb();
    model = root.clone(true);
  } catch (e) {
    console.error('Failed to load Sail_Ship.glb', e);
    const box = new THREE.Mesh(
      new THREE.BoxGeometry(SHIP_HULL_LENGTH, 2, SHIP_HULL_WIDTH),
      new THREE.MeshLambertMaterial({ color: 0x5d3a1a }),
    );
    box.castShadow = true;
    group.add(box);
    group.userData.deckHeight = 1;
    return _makeResult(group, 1);
  }

  model.scale.setScalar(MODEL_SCALE);
  model.position.y = MODEL_Y_OFFSET;
  model.rotation.y = Math.PI / 2;   // bow (+Z in GLB) → +X in group (engine forward)

  group.add(model);

  const deckSections = buildDeckSectionsFromModel(model);
  group.userData.deckSections = deckSections;
  const mainDeck = deckSections.find((d) => d.name === 'main');
  if (mainDeck) {
    group.userData.deckHeight = mainDeck.cy;
  }

  if (SHIP_DEBUG_VISUALS) {
    const hullBox = new THREE.Mesh(
      new THREE.BoxGeometry(SHIP_HULL_LENGTH, SHIP_HULL_HEIGHT, SHIP_HULL_WIDTH),
      new THREE.MeshBasicMaterial({
        color: 0xffe100,
        wireframe: true,
        transparent: true,
        opacity: 0.8,
        depthTest: false,
      }),
    );
    hullBox.position.set(SHIP_HULL_LENGTH * 0.5 - 0.5, MODEL_Y_OFFSET + SHIP_HULL_HEIGHT * 0.5, 0);
    hullBox.name = 'debug-hull-bounds';
    group.add(hullBox);

    const forwardArrow = new THREE.ArrowHelper(
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(4, MODEL_Y_OFFSET + SHIP_HULL_HEIGHT + 1.5, 0),
      5,
      0xff3300,
      1.2,
      0.7,
    );
    forwardArrow.name = 'debug-forward-arrow';
    group.add(forwardArrow);

    const velocityArrow = new THREE.ArrowHelper(
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(4, MODEL_Y_OFFSET + SHIP_HULL_HEIGHT + 0.4, 0),
      0.01,
      0x00ffd0,
      0.8,
      0.45,
    );
    velocityArrow.name = 'debug-velocity-arrow';
    group.add(velocityArrow);
    group.userData.debugVelocityArrow = velocityArrow;
  }

  // ── Invisible per-deck collision boxes ─────────────────────────────────────
  const colMat = new THREE.MeshBasicMaterial({
    color: 0xffe100,
    wireframe: true,
    transparent: true,
    opacity: SHIP_DEBUG_VISUALS ? 0.95 : 0,
    visible: SHIP_DEBUG_VISUALS,
    depthTest: false,
  });

  for (const deck of deckSections) {
    const col = new THREE.Mesh(
      new THREE.BoxGeometry(deck.halfL * 2, 0.4, deck.halfW * 2),
      colMat,
    );
    col.position.set(deck.cx, deck.cy + 0.2, deck.cz);
    col.name = `deck-${deck.name}`;
    group.add(col);
  }

  return _makeResult(group, SHIP_DECK_HEIGHT);
}

function _makeResult(
  group: THREE.Group,
  _deckH: number,
): { mesh: THREE.Group; body: BuoyantBody } {
  return {
    mesh: group,
    body: {
      position:        new THREE.Vector3(0, 0, 0),
      rotation:        new THREE.Euler(0, 0, 0),
      velocity:        new THREE.Vector3(0, 0, 0),
      angularVelocity: new THREE.Vector3(0, 0, 0),
      width:           SHIP_HULL_WIDTH,
      length:          SHIP_HULL_LENGTH,
      height:          SHIP_HULL_HEIGHT,
      mass:            800,
      thrust:          0,
      steering:        0,
    },
  };
}

// ── updateShipMesh ───────────────────────────────────────────────────────────
export function updateShipMesh(mesh: THREE.Group, body: BuoyantBody): void {
  mesh.position.copy(body.position);
  mesh.rotation.x = body.rotation.x;
  mesh.rotation.z = body.rotation.z;
  mesh.rotation.y = body.rotation.y;

  if (SHIP_DEBUG_VISUALS) {
    const velocityArrow = mesh.userData.debugVelocityArrow as THREE.ArrowHelper | undefined;
    if (velocityArrow) {
      // Show real horizontal world velocity converted to ship-local space.
      const vWorld = new THREE.Vector3(body.velocity.x, 0, body.velocity.z);
      const invRot = mesh.quaternion.clone().invert();
      const v = vWorld.applyQuaternion(invRot);
      const speed = v.length();

      if (speed > DEBUG_MIN_ARROW) {
        velocityArrow.visible = true;
        velocityArrow.setDirection(v.normalize());
        velocityArrow.setLength(Math.min(8, Math.max(0.8, speed * 1.8)), 0.8, 0.45);
      } else {
        velocityArrow.visible = false;
      }
    }
  }
}

// ── getDeckHeightAt ──────────────────────────────────────────────────────────
// Returns the deck surface world Y at (worldX, worldZ), or null if outside ship.
// Checks each deck section separately so the player lands on the correct level.
export function getDeckHeightAt(
  ship: { mesh: THREE.Group; body: BuoyantBody },
  worldX: number,
  worldZ: number,
): number | null {
  const { position: shipPos, rotation: shipRot } = ship.body;

  // Transform world point into ship group-local space
  const dx = worldX - shipPos.x;
  const dz = worldZ - shipPos.z;
  const cosA = Math.cos(-shipRot.y);
  const sinA = Math.sin(-shipRot.y);
  const localX =  dx * cosA - dz * sinA;
  const localZ =  dx * sinA + dz * cosA;

  let bestY: number | null = null;

  const deckSections = (ship.mesh.userData.deckSections as DeckSection[] | undefined) ?? DECK_SECTIONS;

  for (const deck of deckSections) {
    if (
      Math.abs(localX - deck.cx) <= deck.halfL &&
      Math.abs(localZ - deck.cz) <= deck.halfW
    ) {
      // Pitch/roll offset at this position
      const pitchOffset =  localX * Math.sin(shipRot.x);
      const rollOffset  = -localZ * Math.sin(shipRot.z);
      const deckWorldY  = shipPos.y + deck.cy + 1.0 + pitchOffset + rollOffset;

      // If player is above multiple decks, return the highest one they're on
      if (bestY === null || deckWorldY > bestY) {
        bestY = deckWorldY;
      }
    }
  }

  return bestY;
}

export interface SpawnedShip {
  mesh: THREE.Group;
  body: BuoyantBody;
}
