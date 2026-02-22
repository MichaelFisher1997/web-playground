import * as THREE from 'three';

const BASE_SPEED = 20.0;
const RUN_MULT   = 5.0;
const DRAG       = 0.85;

export class PlayerController {
  constructor(scene, camera) {
    this.scene  = scene;
    this.camera = camera;

    this.yaw   = 0;
    this.pitch = -0.2;

    // Exposed settings (can be changed by ESC menu)
    this.sensitivity = 6.0;
    this.speed       = BASE_SPEED;

    this._velocity      = new THREE.Vector3();
    this._keys          = {};
    this._pointerLocked = false;

    camera.position.set(0, 40, 80);

    this._bindInputs();
  }

  _bindInputs() {
    window.addEventListener('keydown', (e) => {
      this._keys[e.code] = true;
      if (e.code === 'Space') e.preventDefault();
    });
    window.addEventListener('keyup', (e) => {
      this._keys[e.code] = false;
    });

    document.addEventListener('pointerlockchange', () => {
      this._pointerLocked = document.pointerLockElement === document.body;
      document.getElementById('crosshair')?.classList.toggle('active', this._pointerLocked);
    });

    document.addEventListener('mousemove', (e) => {
      if (!this._pointerLocked) return;
      // sensitivity: higher = faster. movementX is raw pixels.
      const sens = 0.0018 * this.sensitivity;
      this.yaw   -= e.movementX * sens;
      this.pitch  = Math.max(
        -Math.PI / 2 + 0.01,
        Math.min(Math.PI / 2 - 0.01, this.pitch - e.movementY * sens)
      );
    });
  }

  get rotation() { return this.yaw; }

  requestPointerLock() {
    if (!this._pointerLocked) document.body.requestPointerLock();
  }

  releasePointerLock() {
    if (this._pointerLocked) document.exitPointerLock();
  }

  update(dt) {
    const keys  = this._keys;
    const isRun = keys['ShiftLeft'] || keys['ShiftRight'];
    const spd   = this.speed * (isRun ? RUN_MULT : 1);

    const forward = new THREE.Vector3(
      -Math.sin(this.yaw) * Math.cos(this.pitch),
       Math.sin(this.pitch),
      -Math.cos(this.yaw) * Math.cos(this.pitch)
    );
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const up    = new THREE.Vector3(0, 1, 0);

    const move = new THREE.Vector3();
    if (keys['KeyW'] || keys['ArrowUp'])    move.addScaledVector(forward,  1);
    if (keys['KeyS'] || keys['ArrowDown'])  move.addScaledVector(forward, -1);
    if (keys['KeyA'] || keys['ArrowLeft'])  move.addScaledVector(right,   -1);
    if (keys['KeyD'] || keys['ArrowRight']) move.addScaledVector(right,    1);
    if (keys['KeyE'] || keys['Space'])      move.addScaledVector(up,       1);
    if (keys['KeyQ'] || keys['ControlLeft'] || keys['ControlRight']) move.addScaledVector(up, -1);

    if (move.lengthSq() > 0) move.normalize();
    this._velocity.addScaledVector(move, spd * dt);
    this._velocity.multiplyScalar(Math.pow(DRAG, dt * 60));

    this.camera.position.addScaledVector(this._velocity, dt);

    const qYaw   = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);
    const qPitch = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), this.pitch);
    this.camera.quaternion.copy(qYaw).multiply(qPitch);
  }

  getState() {
    return {
      position: { x: this.camera.position.x, y: this.camera.position.y, z: this.camera.position.z },
      rotation: this.yaw,
    };
  }

  destroy() {}
}
