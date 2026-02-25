import * as THREE from 'three';

const BASE_SPEED = 20.0;
const RUN_MULT   = 5.0;
const DRAG       = 0.85;

export type ControlMode = 'god' | 'normal';

export interface PlayerState {
  position: { x: number; y: number; z: number };
  rotation: number;
}

export class PlayerController {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  
  mode: ControlMode = 'normal';
  
  yaw: number = 0;
  pitch: number = -0.2;
  
  sensitivity: number = 6.0;
  speed: number = BASE_SPEED;
  
  private _velocity: THREE.Vector3;
  private _keys: Record<string, boolean> = {};
  private _pointerLocked: boolean = false;
  private _rightMouseDown: boolean = false;
  private _onKeyDown: ((e: KeyboardEvent) => void) | null = null;
  private _onKeyUp: ((e: KeyboardEvent) => void) | null = null;
  private _onPointerLockChange: (() => void) | null = null;
  private _onMouseMove: ((e: MouseEvent) => void) | null = null;

  constructor(scene: THREE.Scene, camera: THREE.PerspectiveCamera, mode: ControlMode = 'normal') {
    this.scene = scene;
    this.camera = camera;
    this.mode = mode;
    this._velocity = new THREE.Vector3();
    
    camera.position.set(0, 40, 80);
    this._bindInputs();
  }

  setMode(mode: ControlMode): void {
    this.mode = mode;
    if (mode === 'god') {
      this.releasePointerLock();
    } else {
      this._rightMouseDown = false;
    }
  }

  private _mouseLookEnabled: boolean = false;

  private _bindInputs(): void {
    this._onKeyDown = (e: KeyboardEvent) => {
      this._keys[e.code] = true;
      if (e.code === 'Space') e.preventDefault();
      
      // Tab toggles mouse look in god mode
      if (e.code === 'Tab' && this.mode === 'god') {
        e.preventDefault();
        this._mouseLookEnabled = !this._mouseLookEnabled;
        if (this._mouseLookEnabled) {
          const promise = document.body.requestPointerLock();
          if (promise && typeof promise.catch === 'function') {
            promise.catch(() => {});
          }
        } else {
          document.exitPointerLock();
        }
      }
    };
    window.addEventListener('keydown', this._onKeyDown);
    
    this._onKeyUp = (e: KeyboardEvent) => {
      this._keys[e.code] = false;
    };
    window.addEventListener('keyup', this._onKeyUp);

    this._onPointerLockChange = () => {
      this._pointerLocked = document.pointerLockElement === document.body;
      if (this.mode === 'normal') {
        document.getElementById('crosshair')?.classList.toggle('active', this._pointerLocked);
      } else {
        // In god mode, crosshair reflects mouse look state
        document.getElementById('crosshair')?.classList.toggle('active', this._mouseLookEnabled && this._pointerLocked);
      }
    };
    document.addEventListener('pointerlockchange', this._onPointerLockChange);

    this._onMouseMove = (e: MouseEvent) => {
      let dx = 0;
      let dy = 0;

      if (this.mode === 'normal') {
        if (!this._pointerLocked) return;
        dx = e.movementX;
        dy = e.movementY;
      } else if (this.mode === 'god') {
        if (!this._mouseLookEnabled || !this._pointerLocked) return;
        dx = e.movementX;
        dy = e.movementY;
      }
      
      const sens = 0.0018 * this.sensitivity;
      this.yaw -= dx * sens;
      this.pitch = Math.max(
        -Math.PI / 2 + 0.01,
        Math.min(Math.PI / 2 - 0.01, this.pitch - dy * sens)
      );
    };
    document.addEventListener('mousemove', this._onMouseMove);
  }

  get rotation(): number { return this.yaw; }

  requestPointerLock(): void {
    if (this.mode === 'normal' && !this._pointerLocked) {
      document.body.requestPointerLock();
    }
  }

  releasePointerLock(): void {
    if (this._pointerLocked) document.exitPointerLock();
  }

  update(dt: number): void {
    const keys = this._keys;
    const isRun = keys['ShiftLeft'] || keys['ShiftRight'];
    const spd = this.speed * (isRun ? RUN_MULT : 1);

    const forward = new THREE.Vector3(
      -Math.sin(this.yaw) * Math.cos(this.pitch),
       Math.sin(this.pitch),
      -Math.cos(this.yaw) * Math.cos(this.pitch)
    );
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const up = new THREE.Vector3(0, 1, 0);

    const move = new THREE.Vector3();
    if (keys['KeyW'] || keys['ArrowUp']) move.addScaledVector(forward, 1);
    if (keys['KeyS'] || keys['ArrowDown']) move.addScaledVector(forward, -1);
    if (keys['KeyA'] || keys['ArrowLeft']) move.addScaledVector(right, -1);
    if (keys['KeyD'] || keys['ArrowRight']) move.addScaledVector(right, 1);
    if (keys['KeyE'] || keys['Space']) move.addScaledVector(up, 1);
    if (keys['KeyQ'] || keys['ControlLeft'] || keys['ControlRight']) move.addScaledVector(up, -1);

    if (move.lengthSq() > 0) move.normalize();
    this._velocity.addScaledVector(move, spd * dt);
    this._velocity.multiplyScalar(Math.pow(DRAG, dt * 60));

    this.camera.position.addScaledVector(this._velocity, dt);

    const qYaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);
    const qPitch = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), this.pitch);
    this.camera.quaternion.copy(qYaw).multiply(qPitch);
  }

  getState(): PlayerState {
    return {
      position: { 
        x: this.camera.position.x, 
        y: this.camera.position.y, 
        z: this.camera.position.z 
      },
      rotation: this.yaw,
    };
  }

  setPosition(x: number, y: number, z: number): void {
    this.camera.position.set(x, y, z);
  }

  destroy(): void {
    if (this._onKeyDown) window.removeEventListener('keydown', this._onKeyDown);
    if (this._onKeyUp) window.removeEventListener('keyup', this._onKeyUp);
    if (this._onPointerLockChange) document.removeEventListener('pointerlockchange', this._onPointerLockChange);
    if (this._onMouseMove) document.removeEventListener('mousemove', this._onMouseMove);
    this._onKeyDown = null;
    this._onKeyUp = null;
    this._onPointerLockChange = null;
    this._onMouseMove = null;
  }
}
