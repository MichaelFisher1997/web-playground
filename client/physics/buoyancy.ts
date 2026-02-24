import * as THREE from 'three';

export interface BuoyantBody {
  position: THREE.Vector3;
  rotation: THREE.Euler;
  velocity: THREE.Vector3;
  angularVelocity: THREE.Vector3;
  driveSpeed?: number;
  width: number;
  length: number;
  height: number;
  mass: number;
  thrust: number;
  steering: number;
}

export interface BuoyancyConfig {
  width?: number;
  length?: number;
  height?: number;
  mass?: number;
}

const WATER_DENSITY = 1000;
const GRAVITY = 9.81;
const DRAG_COEFFICIENT = 0.5;
const ANGULAR_DRAG = 0.85;
const VERTICAL_SPRING = 15.0;
const VERTICAL_DAMPING = 3.0;
const THRUST_FORCE = 25.0;
const TURN_FORCE = 1.5;
const WATER_DRAG = 0.92;
const ANGULAR_WATER_DRAG = 0.92;
const BOAT_FORWARD_LOCAL_X = 1;

export function createBuoyantBody(
  position: THREE.Vector3,
  config: BuoyancyConfig = {}
): BuoyantBody {
  return {
    position: position.clone(),
    rotation: new THREE.Euler(0, 0, 0),
    velocity: new THREE.Vector3(0, 0, 0),
    angularVelocity: new THREE.Vector3(0, 0, 0),
    driveSpeed: 0,
    width: config.width ?? 4,
    length: config.length ?? 12,
    height: config.height ?? 2,
    mass: config.mass ?? 500,
    thrust: 0,
    steering: 0,
  };
}

export type WaterHeightFn = (x: number, z: number, time: number) => number;

export function updateBuoyancy(
  body: BuoyantBody,
  getWaterHeight: WaterHeightFn,
  time: number,
  dt: number
): void {
  const halfW = body.width / 2;
  const halfL = body.length / 2;

  const corners = [
    { x: body.position.x - halfW, z: body.position.z - halfL },
    { x: body.position.x + halfW, z: body.position.z - halfL },
    { x: body.position.x - halfW, z: body.position.z + halfL },
    { x: body.position.x + halfW, z: body.position.z + halfL },
  ];

  const waterHeights = corners.map(c => getWaterHeight(c.x, c.z, time));
  const avgWaterHeight = waterHeights.reduce((a, b) => a + b, 0) / 4;

  const frontAvg = (waterHeights[2] + waterHeights[3]) / 2;
  const backAvg = (waterHeights[0] + waterHeights[1]) / 2;
  const leftAvg = (waterHeights[0] + waterHeights[2]) / 2;
  const rightAvg = (waterHeights[1] + waterHeights[3]) / 2;

  const targetPitch = Math.atan2(frontAvg - backAvg, body.length);
  const targetRoll = Math.atan2(rightAvg - leftAvg, body.width);

  const submersion = Math.max(0, avgWaterHeight - body.position.y + body.height * 0.3);
  const submergedVolume = submersion * body.width * body.length;
  const buoyancyForce = WATER_DENSITY * submergedVolume * GRAVITY / body.mass;

  body.velocity.y += (-GRAVITY + buoyancyForce) * dt;

  const springForce = (avgWaterHeight - body.position.y + body.height * 0.3) * VERTICAL_SPRING;
  const dampingForce = -body.velocity.y * VERTICAL_DAMPING;
  body.velocity.y += (springForce + dampingForce) * dt;

  body.velocity.y *= (1 - DRAG_COEFFICIENT * dt);

  if (body.thrust !== 0 || body.steering !== 0) {
    body.angularVelocity.y += body.steering * TURN_FORCE * dt;
    
    body.thrust *= 0.9;
    body.steering *= 0.85;
    
    if (Math.abs(body.thrust) < 0.01) body.thrust = 0;
    if (Math.abs(body.steering) < 0.01) body.steering = 0;
  }

  const pitchDiff = targetPitch - body.rotation.x;
  const rollDiff = targetRoll - body.rotation.z;

  body.angularVelocity.x += pitchDiff * 2.0 * dt;
  body.angularVelocity.z += rollDiff * 2.0 * dt;

  body.angularVelocity.x *= (1 - ANGULAR_DRAG * dt);
  body.angularVelocity.z *= (1 - ANGULAR_DRAG * dt);
  body.angularVelocity.y *= ANGULAR_WATER_DRAG;

  body.rotation.x += body.angularVelocity.x * dt;
  body.rotation.z += body.angularVelocity.z * dt;
  body.rotation.y += body.angularVelocity.y * dt;

  // Arcade lock: use the same local forward axis as the debug red arrow.
  const headingForward = new THREE.Vector3(BOAT_FORWARD_LOCAL_X, 0, 0).applyEuler(body.rotation);
  headingForward.y = 0;
  if (headingForward.lengthSq() < 1e-6) {
    headingForward.set(1, 0, 0);
  }
  headingForward.normalize();

  const prevSpeed = body.driveSpeed ?? (body.velocity.x * headingForward.x + body.velocity.z * headingForward.z);
  const nextSpeed = THREE.MathUtils.clamp((prevSpeed + body.thrust * THRUST_FORCE * dt) * WATER_DRAG, -12, 16);
  body.driveSpeed = nextSpeed;
  body.velocity.x = headingForward.x * nextSpeed;
  body.velocity.z = headingForward.z * nextSpeed;

  body.position.add(body.velocity.clone().multiplyScalar(dt));

  body.rotation.x = Math.max(-0.4, Math.min(0.4, body.rotation.x));
  body.rotation.z = Math.max(-0.4, Math.min(0.4, body.rotation.z));
}

export function applyBoatInput(body: BuoyantBody, thrust: number, steering: number): void {
  body.thrust = Math.max(-1, Math.min(1, body.thrust + thrust * 0.15));
  body.steering = Math.max(-1, Math.min(1, body.steering + steering * 0.2));
}
