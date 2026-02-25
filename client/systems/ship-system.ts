import type { Scene } from 'three';
import type { PlayModeController } from '../player/play-controller.js';
import { createShip, getDeckHeightAt, type SpawnedShip, updateShipMesh } from '../objects/ship.js';
import { applyBoatInput, type WaterHeightFn, updateBuoyancy } from '../physics/buoyancy.js';

export class ShipSystem {
  private scene: Scene;
  private getWaterHeight: WaterHeightFn;
  private spawnedShips: SpawnedShip[] = [];
  private drivenShip: SpawnedShip | null = null;
  private deckOffset: { x: number; z: number } = { x: 0, z: 0 };

  constructor(scene: Scene, getWaterHeight: WaterHeightFn) {
    this.scene = scene;
    this.getWaterHeight = getWaterHeight;
  }

  getShips(): SpawnedShip[] {
    return this.spawnedShips;
  }

  getDrivenShip(): SpawnedShip | null {
    return this.drivenShip;
  }

  clearDrivenState(playController?: PlayModeController): void {
    if (playController) {
      playController.setDrivingBoat(false);
    }
    this.drivenShip = null;
    this.deckOffset.x = 0;
    this.deckOffset.z = 0;
  }

  async spawnShipAt(x: number, z: number, time: number): Promise<void> {
    const { mesh, body } = await createShip();
    const waterY = this.getWaterHeight(x, z, time);
    body.position.set(x, waterY + 1, z);
    body.rotation.y = Math.random() * Math.PI * 2;
    updateShipMesh(mesh, body);
    this.scene.add(mesh);
    this.spawnedShips.push({ mesh, body });
  }

  getHighestDeckHeightAt(x: number, z: number): number | null {
    let highestDeck: number | null = null;
    for (const ship of this.spawnedShips) {
      const deckY = getDeckHeightAt(ship, x, z);
      if (deckY !== null && (highestDeck === null || deckY > highestDeck)) {
        highestDeck = deckY;
      }
    }
    return highestDeck;
  }

  enterBoat(playController: PlayModeController, notify: (text: string) => void): void {
    const playerPos = playController.getCharacterPosition();
    for (const ship of this.spawnedShips) {
      const deckY = getDeckHeightAt(ship, playerPos.x, playerPos.z);
      if (deckY === null) continue;
      this.drivenShip = ship;
      this.deckOffset.x = 1.8;
      this.deckOffset.z = 0;
      const shipPos = ship.body.position;
      const shipRot = ship.body.rotation.y;
      const cos = Math.cos(shipRot);
      const sin = Math.sin(shipRot);
      const helmX = shipPos.x + this.deckOffset.x * cos - this.deckOffset.z * sin;
      const helmZ = shipPos.z + this.deckOffset.x * sin + this.deckOffset.z * cos;
      const helmY = getDeckHeightAt(ship, helmX, helmZ) ?? deckY;
      playController.setPosition(helmX, helmY, helmZ);
      playController.setDrivingBoat(true);
      notify('Driving boat! WASD to steer, E to exit');
      break;
    }
  }

  exitBoat(playController: PlayModeController, notify: (text: string) => void): void {
    if (this.drivenShip) {
      const shipPos = this.drivenShip.body.position;
      const shipRot = this.drivenShip.body.rotation.y;
      const cos = Math.cos(shipRot);
      const sin = Math.sin(shipRot);
      const exitX = shipPos.x + this.deckOffset.x * cos - this.deckOffset.z * sin + 2;
      const exitZ = shipPos.z + this.deckOffset.x * sin + this.deckOffset.z * cos;
      const exitY = getDeckHeightAt(this.drivenShip, exitX, exitZ) ?? shipPos.y + 2;
      playController.setPosition(exitX, exitY, exitZ);
      playController.setDrivingBoat(false);
    }
    this.drivenShip = null;
    notify('Exited boat');
  }

  applyDrivenInput(thrust: number, steering: number): void {
    if (this.drivenShip) {
      applyBoatInput(this.drivenShip.body, thrust, steering);
    }
  }

  attachDrivenPlayer(playController: PlayModeController): void {
    if (!this.drivenShip || !playController.isDrivingBoat()) return;
    const shipPos = this.drivenShip.body.position;
    const shipRot = this.drivenShip.body.rotation.y;
    const cos = Math.cos(shipRot);
    const sin = Math.sin(shipRot);
    const anchorX = shipPos.x + this.deckOffset.x * cos - this.deckOffset.z * sin;
    const anchorZ = shipPos.z + this.deckOffset.x * sin + this.deckOffset.z * cos;
    const anchorY = getDeckHeightAt(this.drivenShip, anchorX, anchorZ) ?? (shipPos.y + 1.5);
    playController.attachToShip(shipPos, shipRot, this.deckOffset, anchorY);
  }

  update(time: number, dt: number): void {
    for (const ship of this.spawnedShips) {
      updateBuoyancy(ship.body, this.getWaterHeight, time, dt);
      updateShipMesh(ship.mesh, ship.body);
    }
  }
}
