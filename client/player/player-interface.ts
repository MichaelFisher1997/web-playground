export interface PlayerPositionState {
  position: { x: number; y: number; z: number };
  rotation: number;
}

export interface PlayerVitalsState {
  health: number;
  stamina: number;
}

export interface IPlayerController {
  yaw: number;
  pitch: number;
  sensitivity: number;
  update(dt: number): void;
  getState(): PlayerPositionState;
  setPosition(x: number, y: number, z: number): void;
  requestPointerLock(): void;
  releasePointerLock(): void;
  destroy(): void;
}
