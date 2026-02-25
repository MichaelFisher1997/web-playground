import * as THREE from 'three';
import type { Island } from '../world/islands.js';

export interface TerrainHeightProvider {
  getHeightAt(x: number, z: number): number;
  getIslands(): Island[];
  config: { waterHeight: number };
}

const WALK_SPEED = 6.0;
const SPRINT_SPEED = 10.0;
const GRAVITY = 28.0;
const JUMP_FORCE = 10.0;
const JUMP_COOLDOWN = 0.3;
const STAMINA_MAX = 100.0;
const STAMINA_REGEN_RATE = 25.0;
const SPRINT_STAMINA_COST = 30.0;
const JUMP_STAMINA_COST = 20.0;
const STAMINA_REGEN_DELAY = 1.0;
const FALL_DAMAGE_THRESHOLD = 10.0;
const FALL_DAMAGE_MULTIPLIER = 8.0;
const PLAYER_HEIGHT = 1.8;
const PLAYER_RADIUS = 0.4;

export interface PlayControllerState {
  position: { x: number; y: number; z: number };
  rotation: number;
  health: number;
  stamina: number;
  isGrounded: boolean;
}

export interface PlayControllerCallbacks {
  onWaterDeath?: () => void;
  onHealthChange?: (health: number) => void;
  onStaminaChange?: (stamina: number) => void;
  getShipDeckHeight?: (x: number, z: number) => number | null;
  onEnterBoat?: () => void;
  onExitBoat?: () => void;
  onBoatInput?: (thrust: number, steering: number) => void;
}

export class PlayModeController {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private terrainProvider: TerrainHeightProvider;

  private _velocity: THREE.Vector3 = new THREE.Vector3();
  private _isGrounded: boolean = false;
  private _keys: Record<string, boolean> = {};
  private _pointerLocked: boolean = false;
  private _onKeyDown: ((e: KeyboardEvent) => void) | null = null;
  private _onKeyUp: ((e: KeyboardEvent) => void) | null = null;
  private _onWheel: ((e: WheelEvent) => void) | null = null;
  private _onPointerLockChange: (() => void) | null = null;
  private _onMouseMove: ((e: MouseEvent) => void) | null = null;

  yaw: number = 0;
  pitch: number = 0;
  sensitivity: number = 6.0;
  private _cameraDistance: number = 9;
  private _isFirstPerson: boolean = false;
  private _lastEnterPress: number = 0;

  private _characterMesh: THREE.Group;
  private _rifle: THREE.Group;
  private _upperBody: THREE.Group;
  private _firstPersonGun: THREE.Group;
  private _raycaster: THREE.Raycaster = new THREE.Raycaster();
  private _aimPoint: THREE.Vector3 = new THREE.Vector3();

  health: number = 100;
  stamina: number = STAMINA_MAX;
  private _staminaRegenTimer: number = 0;
  private _fallStartY: number = 0;
  private _wasGrounded: boolean = false;
  private _jumpCooldownTimer: number = 0;

  private _callbacks: PlayControllerCallbacks = {};

  private _standingOnShip: boolean = false;
  private _shipVelocity: THREE.Vector3 = new THREE.Vector3();
  private _isDrivingBoat: boolean = false;
  private _driveCooldown: number = 0;

  constructor(
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    terrainProvider: TerrainHeightProvider,
    spawnPosition: { x: number; y: number; z: number },
    callbacks: PlayControllerCallbacks = {},
  ) {
    this.scene = scene;
    this.camera = camera;
    this.terrainProvider = terrainProvider;
    this._callbacks = callbacks;

    const created = this._createCharacterMesh();
    this._characterMesh = created.mesh;
    this._upperBody = created.upperBody;
    this._rifle = created.rifle;
    this._firstPersonGun = this._createFirstPersonGun();
    this.scene.add(this._characterMesh);
    if (this.camera.parent !== this.scene) {
      this.scene.add(this.camera);
    }
    this.camera.add(this._firstPersonGun);
    this._firstPersonGun.visible = false;

    this._characterMesh.position.set(spawnPosition.x, spawnPosition.y, spawnPosition.z);
    this._fallStartY = spawnPosition.y;

    this._bindInputs();
    this._updateCameraPosition();
  }

  setCallbacks(callbacks: PlayControllerCallbacks): void {
    this._callbacks = callbacks;
  }

  private _createFirstPersonGun(): THREE.Group {
    const gun = new THREE.Group();
    const rifleMat = new THREE.MeshLambertMaterial({ color: 0x3a3a3a, emissive: 0x111111 });

    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.12, 0.75), rifleMat);
    gun.add(receiver);

    const barrel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.018, 0.018, 0.55, 6),
      new THREE.MeshLambertMaterial({ color: 0x121212 })
    );
    barrel.rotation.x = Math.PI / 2;
    barrel.position.z = 0.52;
    barrel.position.y = 0.02;
    gun.add(barrel);

    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.14, 0.3), rifleMat);
    stock.position.z = -0.38;
    stock.position.y = -0.05;
    gun.add(stock);

    // Right-handed first person placement in camera local space.
    gun.scale.setScalar(0.65);
    gun.position.set(0.35, -0.26, -0.72);
    gun.rotation.set(0.05, 0.06, -0.02);
    return gun;
  }

  private _createCharacterMesh(): { mesh: THREE.Group; upperBody: THREE.Group; rifle: THREE.Group } {
    const mesh = new THREE.Group();

    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(PLAYER_RADIUS, PLAYER_HEIGHT - PLAYER_RADIUS * 2, 4, 8),
      new THREE.MeshLambertMaterial({ color: 0x4fc3f7 })
    );
    body.position.y = PLAYER_HEIGHT / 2;
    body.castShadow = true;
    mesh.add(body);

    const upperBody = new THREE.Group();
    upperBody.position.y = 1.3;
    mesh.add(upperBody);

    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.23, 8, 6),
      new THREE.MeshLambertMaterial({ color: 0xffd54f })
    );
    head.position.y = 0.28;
    upperBody.add(head);

    const rifle = new THREE.Group();
    const rifleMat = new THREE.MeshLambertMaterial({ color: 0x333333 });

    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.12, 0.75), rifleMat);
    rifle.add(receiver);

    const barrel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.02, 0.02, 0.5, 6),
      new THREE.MeshLambertMaterial({ color: 0x161616 })
    );
    barrel.rotation.x = Math.PI / 2;
    barrel.position.z = 0.48;
    barrel.position.y = 0.02;
    rifle.add(barrel);

    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.14, 0.28), rifleMat);
    stock.position.z = -0.38;
    stock.position.y = -0.05;
    rifle.add(stock);

    // Character right hand from player perspective.
    rifle.position.set(-0.24, -0.12, 0.18);
    upperBody.add(rifle);

    return { mesh, upperBody, rifle };
  }

  private _bindInputs(): void {
    this._onKeyDown = (e: KeyboardEvent) => {
      this._keys[e.code] = true;
      if (e.code === 'Space') e.preventDefault();

      if (e.code === 'Enter') {
        const now = Date.now();
        if (now - this._lastEnterPress > 250) {
          this._lastEnterPress = now;
          this._toggleCameraMode();
        }
      }
    };
    window.addEventListener('keydown', this._onKeyDown);

    this._onKeyUp = (e: KeyboardEvent) => {
      this._keys[e.code] = false;
    };
    window.addEventListener('keyup', this._onKeyUp);

    this._onWheel = (e: WheelEvent) => {
      if (!this._isFirstPerson) {
        this._cameraDistance = Math.max(4, Math.min(16, this._cameraDistance + Math.sign(e.deltaY) * 0.6));
      }
    };
    window.addEventListener('wheel', this._onWheel, { passive: true });

    this._onPointerLockChange = () => {
      this._pointerLocked = document.pointerLockElement === document.body;
      const crosshair = document.getElementById('crosshair');
      if (crosshair) crosshair.classList.toggle('active', this._pointerLocked);
    };
    document.addEventListener('pointerlockchange', this._onPointerLockChange);

    this._onMouseMove = (e: MouseEvent) => {
      if (!this._pointerLocked) return;

      const sens = 0.0018 * this.sensitivity;
      this.yaw -= e.movementX * sens;
      this.pitch = Math.max(-0.55, Math.min(1.1, this.pitch + e.movementY * sens));
    };
    document.addEventListener('mousemove', this._onMouseMove);
  }

  private _toggleCameraMode(): void {
    this._isFirstPerson = !this._isFirstPerson;
    this._characterMesh.visible = !this._isFirstPerson;
    this._firstPersonGun.visible = this._isFirstPerson;
    if (!this._isFirstPerson) this._cameraDistance = 9;

    const crosshair = document.getElementById('crosshair');
    if (crosshair && this._pointerLocked) {
      crosshair.style.left = '50%';
      crosshair.style.top = '50%';
      crosshair.style.transform = 'translate(-50%, -50%)';
    }
  }

  requestPointerLock(): void {
    if (!this._pointerLocked) document.body.requestPointerLock();
  }

  releasePointerLock(): void {
    if (this._pointerLocked) document.exitPointerLock();
  }

  setVisible(visible: boolean): void {
    this._characterMesh.visible = visible && !this._isFirstPerson;
    this._firstPersonGun.visible = visible && this._isFirstPerson;
  }

  private _forwardDir(): THREE.Vector3 {
    return new THREE.Vector3(
      Math.sin(this.yaw) * Math.cos(this.pitch),
      -Math.sin(this.pitch),
      Math.cos(this.yaw) * Math.cos(this.pitch)
    ).normalize();
  }

  private _flatForwardDir(): THREE.Vector3 {
    return new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw)).normalize();
  }

  private _updateCameraPosition(): void {
    const pos = this._characterMesh.position;
    const forward = this._forwardDir();
    const flatForward = this._flatForwardDir();
    const right = new THREE.Vector3(flatForward.z, 0, -flatForward.x).normalize();

    if (this._isFirstPerson) {
      const eye = new THREE.Vector3(pos.x, pos.y + 1.6, pos.z);
      const look = eye.clone().add(forward.clone().multiplyScalar(80));
      this.camera.position.copy(eye);
      this.camera.lookAt(look);

      this._firstPersonGun.visible = true;
      this._firstPersonGun.position.set(0.35, -0.26, -0.72);
      this._firstPersonGun.rotation.set(0.05 + this.pitch * 0.08, 0.06, -0.02);
    } else {
      this._firstPersonGun.visible = false;
      const pivot = new THREE.Vector3(pos.x, pos.y + 1.55, pos.z);
      const shoulderOffset = right.clone().multiplyScalar(0.85);
      const pitchDown = Math.max(0, this.pitch);

      // Orbit camera around player so looking down naturally moves camera up.
      const orbitPitch = THREE.MathUtils.clamp(this.pitch + 0.1, -0.45, 1.1);
      let dynamicDistance = this._cameraDistance * (1 - pitchDown * 0.42);
      dynamicDistance = Math.max(3.8, dynamicDistance);

      const orbitBack = flatForward.clone().multiplyScalar(-Math.cos(orbitPitch) * dynamicDistance);
      const orbitUp = new THREE.Vector3(0, Math.sin(orbitPitch) * dynamicDistance + 0.75, 0);

      let desired = pivot.clone().add(shoulderOffset).add(orbitBack).add(orbitUp);

      // Terrain collision response: if camera goes into terrain, zoom in first, then clamp.
      const terrainHeight = this._getTerrainHeightAt(desired.x, desired.z);
      const minY = terrainHeight + 0.9;
      if (desired.y < minY) {
        const penetration = minY - desired.y;
        dynamicDistance *= Math.max(0.35, 1 - penetration / 4.5);

        const zoomBack = flatForward.clone().multiplyScalar(-Math.cos(orbitPitch) * dynamicDistance);
        const zoomUp = new THREE.Vector3(0, Math.sin(orbitPitch) * dynamicDistance + 0.75, 0);
        desired = pivot.clone().add(shoulderOffset).add(zoomBack).add(zoomUp);

        const terrainAfterZoom = this._getTerrainHeightAt(desired.x, desired.z);
        desired.y = Math.max(desired.y, terrainAfterZoom + 0.9);
      }

      this.camera.position.lerp(desired, 0.16);

      const lookDistance = Math.max(12, 28 - pitchDown * 8);
      const look = pivot.clone().add(forward.clone().multiplyScalar(lookDistance));
      this.camera.lookAt(look);
    }

    const crosshair = document.getElementById('crosshair');
    if (crosshair && this._pointerLocked) {
      crosshair.style.left = '50%';
      crosshair.style.top = '50%';
      crosshair.style.transform = 'translate(-50%, -50%)';
    }
  }

  private _updateAimPose(dt: number): void {
    this._computeAimPoint(this._aimPoint);

    const pos = this._characterMesh.position;
    const toAimX = this._aimPoint.x - pos.x;
    const toAimZ = this._aimPoint.z - pos.z;
    const targetYaw = Math.atan2(toAimX, toAimZ);

    let yawDiff = targetYaw - this._characterMesh.rotation.y;
    while (yawDiff > Math.PI) yawDiff -= Math.PI * 2;
    while (yawDiff < -Math.PI) yawDiff += Math.PI * 2;
    this._characterMesh.rotation.y += yawDiff * Math.min(1, dt * 16);

    const shoulderPos = new THREE.Vector3();
    this._upperBody.getWorldPosition(shoulderPos);
    const dx = this._aimPoint.x - shoulderPos.x;
    const dy = this._aimPoint.y - shoulderPos.y;
    const dz = this._aimPoint.z - shoulderPos.z;
    const horizontal = Math.sqrt(dx * dx + dz * dz);
    const pitchToAim = Math.atan2(dy, Math.max(horizontal, 0.001));

    const upperPitch = Math.max(-0.75, Math.min(0.65, -pitchToAim));
    this._upperBody.rotation.x += (upperPitch - this._upperBody.rotation.x) * Math.min(1, dt * 14);
    this._rifle.rotation.x = this._upperBody.rotation.x * 0.08;
  }

  private _computeAimPoint(out: THREE.Vector3): void {
    this._raycaster.setFromCamera(new THREE.Vector2(0, 0), this.camera);
    const origin = this._raycaster.ray.origin;
    const direction = this._raycaster.ray.direction;

    const maxDistance = 200;
    const steps = 120;
    const step = maxDistance / steps;

    for (let i = 1; i <= steps; i++) {
      const dist = i * step;
      const x = origin.x + direction.x * dist;
      const y = origin.y + direction.y * dist;
      const z = origin.z + direction.z * dist;
      const terrainY = this._getTerrainHeightAt(x, z);

      if (y <= terrainY + 0.35) {
        out.set(x, terrainY + 0.35, z);
        return;
      }
    }

    out.set(
      origin.x + direction.x * maxDistance,
      origin.y + direction.y * maxDistance,
      origin.z + direction.z * maxDistance
    );
  }

  private _getTerrainHeightAt(x: number, z: number): number {
    return this.terrainProvider.getHeightAt(x, z);
  }

  private _checkGroundCollision(): { isGrounded: boolean; height: number; isShip: boolean } {
    const pos = this._characterMesh.position;
    const groundHeight = this._getTerrainHeightAt(pos.x, pos.z);
    
    let surfaceHeight = groundHeight;
    let isShip = false;
    
    if (this._callbacks.getShipDeckHeight) {
      const shipDeckHeight = this._callbacks.getShipDeckHeight(pos.x, pos.z);
      if (shipDeckHeight !== null && shipDeckHeight > groundHeight) {
        surfaceHeight = shipDeckHeight;
        isShip = true;
      }
    }
    
    const isGrounded = pos.y <= surfaceHeight + 0.45 && this._velocity.y <= 1.0;
    return { isGrounded, height: surfaceHeight, isShip };
  }

  private _applyFallDamage(fallDistance: number): void {
    if (fallDistance > FALL_DAMAGE_THRESHOLD) {
      const damage = (fallDistance - FALL_DAMAGE_THRESHOLD) * FALL_DAMAGE_MULTIPLIER;
      this.health = Math.max(0, this.health - damage);
      this._callbacks.onHealthChange?.(this.health);
    }
  }

  private _respawn(): void {
    const islands = this.terrainProvider.getIslands();
    if (islands.length === 0) {
      this._characterMesh.position.set(0, 50, 0);
    } else {
      const island = islands[Math.floor(Math.random() * islands.length)];
      const angle = Math.random() * Math.PI * 2;
      const dist = Math.random() * island.radius * 0.45;
      const x = island.x + Math.cos(angle) * dist;
      const z = island.z + Math.sin(angle) * dist;
      const y = this._getTerrainHeightAt(x, z) + PLAYER_HEIGHT;
      this._characterMesh.position.set(x, y, z);
    }

    this._velocity.set(0, 0, 0);
    this.health = 100;
    this.stamina = STAMINA_MAX;
    this._callbacks.onHealthChange?.(this.health);
    this._callbacks.onStaminaChange?.(this.stamina);
  }

  update(dt: number): void {
    const keys = this._keys;

    if (this._jumpCooldownTimer > 0) this._jumpCooldownTimer -= dt;
    if (this._driveCooldown > 0) this._driveCooldown -= dt;

    const waterHeight = this.terrainProvider.config.waterHeight;
    const playerY = this._characterMesh.position.y;
    const isInWater = playerY < waterHeight + 0.5;

    let deckHeight: number | null = null;
    if (this._callbacks.getShipDeckHeight) {
      deckHeight = this._callbacks.getShipDeckHeight(this._characterMesh.position.x, this._characterMesh.position.z);
    }
    
    this._standingOnShip = deckHeight !== null && playerY <= deckHeight + 1.5;

    if (this._isDrivingBoat) {
      let thrust = 0;
      let steering = 0;
      
      if (keys['KeyW'] || keys['ArrowUp']) thrust = 1;
      if (keys['KeyS'] || keys['ArrowDown']) thrust = -1;
      if (keys['KeyA'] || keys['ArrowLeft']) steering = 1;
      if (keys['KeyD'] || keys['ArrowRight']) steering = -1;
      
      this._callbacks.onBoatInput?.(thrust, steering);
      
      if (keys['KeyE'] && this._driveCooldown <= 0) {
          this._callbacks.onExitBoat?.();
        this._isDrivingBoat = false;
        this._driveCooldown = 0.3;
      }
      
      this._updateCameraPosition();
      return;
    }

    if (keys['KeyE'] && this._standingOnShip && this._driveCooldown <= 0) {
      this._callbacks.onEnterBoat?.();
      this._driveCooldown = 0.3;
    }
    
    if (isInWater && !this._standingOnShip) {
      const targetY = waterHeight + 0.3;
      const buoyancy = (targetY - playerY) * 5.0;
      this._velocity.y += buoyancy * dt;
      this._velocity.y *= 0.95;
      this._velocity.x *= 0.92;
      this._velocity.z *= 0.92;
      
      if (keys['Space']) {
        this._velocity.y = Math.max(this._velocity.y, 3.0);
      }
      if (keys['KeyQ'] || keys['ControlLeft'] || keys['ControlRight']) {
        this._velocity.y -= 3.0 * dt;
      }
      
      if (playerY < waterHeight - 8) {
        this._callbacks.onWaterDeath?.();
        this._respawn();
        return;
      }
    }

    const ground = this._checkGroundCollision();
    this._isGrounded = ground.isGrounded || this._standingOnShip;

    if (!this._wasGrounded && this._isGrounded) {
      const fallDistance = Math.max(0, this._fallStartY - this._characterMesh.position.y);
      this._applyFallDamage(fallDistance);
      this._fallStartY = this._characterMesh.position.y;
    } else if (!this._isGrounded && this._wasGrounded) {
      this._fallStartY = this._characterMesh.position.y;
    }
    this._wasGrounded = this._isGrounded;

    if (this._staminaRegenTimer > 0) {
      this._staminaRegenTimer -= dt;
    } else if (this.stamina < STAMINA_MAX) {
      const prev = this.stamina;
      this.stamina = Math.min(STAMINA_MAX, this.stamina + STAMINA_REGEN_RATE * dt);
      if (Math.floor(prev) !== Math.floor(this.stamina)) this._callbacks.onStaminaChange?.(this.stamina);
    }

    const isSprinting = (keys['ShiftLeft'] || keys['ShiftRight']) && this.stamina > 0;
    const moveSpeed = isSprinting ? SPRINT_SPEED : WALK_SPEED;

    const flatForward = this._flatForwardDir();
    const right = new THREE.Vector3(flatForward.z, 0, -flatForward.x).normalize();

    const move = new THREE.Vector3();
    if (keys['KeyW'] || keys['ArrowUp']) move.add(flatForward);
    if (keys['KeyS'] || keys['ArrowDown']) move.sub(flatForward);
    if (keys['KeyA'] || keys['ArrowLeft']) move.add(right);
    if (keys['KeyD'] || keys['ArrowRight']) move.sub(right);

    if (move.lengthSq() > 0) {
      move.normalize();
      if (isSprinting) {
        this.stamina = Math.max(0, this.stamina - SPRINT_STAMINA_COST * dt);
        this._staminaRegenTimer = STAMINA_REGEN_DELAY;
        this._callbacks.onStaminaChange?.(this.stamina);
      }
      this._velocity.x = move.x * moveSpeed;
      this._velocity.z = move.z * moveSpeed;
    } else {
      this._velocity.x *= 0.8;
      this._velocity.z *= 0.8;
    }

    if (keys['Space'] && this._isGrounded && this._jumpCooldownTimer <= 0 && this.stamina >= JUMP_STAMINA_COST && !isInWater) {
      this._velocity.y = JUMP_FORCE;
      this._jumpCooldownTimer = JUMP_COOLDOWN;
      this._isGrounded = false;
      this.stamina = Math.max(0, this.stamina - JUMP_STAMINA_COST);
      this._staminaRegenTimer = STAMINA_REGEN_DELAY;
      this._callbacks.onStaminaChange?.(this.stamina);
    }

    if (!isInWater || this._standingOnShip) {
      this._velocity.y -= GRAVITY * dt;
    }

    const next = this._characterMesh.position.clone();
    next.addScaledVector(this._velocity, dt);

    const terrainHeight = this._getTerrainHeightAt(next.x, next.z);
    let surfaceHeight = terrainHeight;
    
    if (this._callbacks.getShipDeckHeight) {
      const shipDeck = this._callbacks.getShipDeckHeight(next.x, next.z);
      if (shipDeck !== null && shipDeck > surfaceHeight) {
        surfaceHeight = shipDeck;
        this._standingOnShip = true;
      }
    }
    
    if (next.y < surfaceHeight + PLAYER_HEIGHT * 0.1) {
      next.y = surfaceHeight + PLAYER_HEIGHT * 0.1;
      this._velocity.y = Math.max(0, this._velocity.y);
      this._isGrounded = true;
    }

    this._characterMesh.position.copy(next);

    this._updateCameraPosition();
    if (!this._isFirstPerson) this._updateAimPose(dt);
  }

  getState(): PlayControllerState {
    return {
      position: {
        x: this._characterMesh.position.x,
        y: this._characterMesh.position.y,
        z: this._characterMesh.position.z,
      },
      rotation: this._characterMesh.rotation.y,
      health: this.health,
      stamina: this.stamina,
      isGrounded: this._isGrounded,
    };
  }

  setPosition(x: number, y: number, z: number): void {
    this._characterMesh.position.set(x, y, z);
    this._velocity.set(0, 0, 0);
  }

  getCharacterPosition(): THREE.Vector3 {
    return this._characterMesh.position.clone();
  }

  isGrounded(): boolean {
    return this._isGrounded;
  }

  isDrivingBoat(): boolean {
    return this._isDrivingBoat;
  }

  setDrivingBoat(driving: boolean): void {
    this._isDrivingBoat = driving;
    this._driveCooldown = 0.3;
  }

  isOnShip(): boolean {
    return this._standingOnShip;
  }

  attachToShip(
    shipPosition: THREE.Vector3,
    shipRotation: number,
    deckOffset: { x: number; z: number },
    deckY?: number,
  ): void {
    const cos = Math.cos(shipRotation);
    const sin = Math.sin(shipRotation);
    const worldX = shipPosition.x + deckOffset.x * cos - deckOffset.z * sin;
    const worldZ = shipPosition.z + deckOffset.x * sin + deckOffset.z * cos;
    
    this._characterMesh.position.x = worldX;
    this._characterMesh.position.z = worldZ;
    if (deckY !== undefined) {
      this._characterMesh.position.y = deckY;
    }
    this._characterMesh.rotation.y = shipRotation;
    
    this._velocity.set(0, 0, 0);
    
    this._updateCameraPosition();
  }

  destroy(): void {
    if (this._onKeyDown) window.removeEventListener('keydown', this._onKeyDown);
    if (this._onKeyUp) window.removeEventListener('keyup', this._onKeyUp);
    if (this._onWheel) window.removeEventListener('wheel', this._onWheel);
    if (this._onPointerLockChange) document.removeEventListener('pointerlockchange', this._onPointerLockChange);
    if (this._onMouseMove) document.removeEventListener('mousemove', this._onMouseMove);
    this.scene.remove(this._characterMesh);
    this.camera.remove(this._firstPersonGun);
  }
}
