import * as THREE from 'three';

export interface GameLoopHandlers {
  update: (dt: number, time: number) => void;
  render: (time: number) => void;
}

export class GameLoop {
  private clock = new THREE.Clock();
  private handlers: GameLoopHandlers;

  constructor(handlers: GameLoopHandlers) {
    this.handlers = handlers;
  }

  start(): void {
    const animate = (): void => {
      requestAnimationFrame(animate);
      const dt = Math.min(this.clock.getDelta(), 0.05);
      const time = this.clock.getElapsedTime();
      this.handlers.update(dt, time);
      this.handlers.render(time);
    };
    animate();
  }

  getElapsedTime(): number {
    return this.clock.getElapsedTime();
  }
}
