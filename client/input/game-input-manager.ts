import * as THREE from 'three';

export interface GameInputContext {
  getGameState: () => 'menu' | 'playmenu' | 'sandbox' | 'playing' | 'paused';
  isEscOpen: () => boolean;
  isGodModeActive: () => boolean;
  onOpenEsc: () => void;
  onCloseEsc: () => void;
  onToggleGodMode: () => void;
  onEscapeInSandbox: () => void;
  onToggleSandboxPanel: () => void;
  onToggleSpawnPanel: () => void;
  onToggleGlobalMap: () => void;
  onGlobalMapOpened: () => void;
  onGlobalMapClosed: () => void;
  onCanvasClick: (event: MouseEvent) => void;
  updateSensitivity: (value: number) => void;
  updateSpeed: (value: number) => void;
  updateFov: (value: number) => void;
  updateQuality: (value: number) => void;
  updateShadows: (enabled: boolean) => void;
  onPointerLockChange: (isLocked: boolean) => void;
  onEscTabPlayers: () => void;
}

export class GameInputManager {
  private ctx: GameInputContext;

  constructor(ctx: GameInputContext) {
    this.ctx = ctx;
  }

  bind(renderer: THREE.WebGLRenderer): void {
    document.addEventListener('pointerlockchange', () => {
      if (this.ctx.getGameState() === 'sandbox') return;
      const isLocked = document.pointerLockElement === document.body;
      this.ctx.onPointerLockChange(isLocked);
    });

    document.addEventListener('keydown', (e) => {
      const state = this.ctx.getGameState();
      if (state === 'menu' || state === 'playmenu') return;

      if (e.code === 'Escape') {
        if (state === 'sandbox') {
          this.ctx.onEscapeInSandbox();
          return;
        }
        if (this.ctx.isGodModeActive() && state === 'playing') {
          this.ctx.onToggleGodMode();
          return;
        }
        const isLocked = document.pointerLockElement === document.body;
        e.preventDefault();
        if (isLocked) this.ctx.onOpenEsc();
        else this.ctx.isEscOpen() ? this.ctx.onCloseEsc() : this.ctx.onOpenEsc();
        return;
      }

      if (e.code === 'KeyG' && state === 'sandbox') {
        this.ctx.onToggleSandboxPanel();
        return;
      }

      if (e.code === 'KeyY' && state === 'playing') {
        e.preventDefault();
        e.stopPropagation();
        this.ctx.onToggleGodMode();
        return;
      }

      if (e.code === 'KeyP') {
        if (state === 'sandbox' || (state === 'playing' && this.ctx.isGodModeActive())) {
          this.ctx.onToggleSpawnPanel();
        }
      }

      if (e.code === 'KeyM' && (state === 'playing' || state === 'sandbox')) {
        e.preventDefault();
        this.ctx.onToggleGlobalMap();
      }
    }, true);

    document.getElementById('canvas-container')!.addEventListener('click', (e) => {
      this.ctx.onCanvasClick(e as MouseEvent);
    });

    document.getElementById('esc-resume')!.addEventListener('click', () => this.ctx.onCloseEsc());
    document.getElementById('esc-disconnect')!.addEventListener('click', () => location.reload());

    document.querySelectorAll('.esc-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.esc-tab').forEach((t) => t.classList.remove('active'));
        document.querySelectorAll('.esc-pane').forEach((p) => p.classList.remove('active'));
        tab.classList.add('active');
        const pane = document.getElementById(`tab-${(tab as HTMLElement).dataset.tab}`);
        pane?.classList.add('active');
        if ((tab as HTMLElement).dataset.tab === 'players') this.ctx.onEscTabPlayers();
      });
    });

    const sensSlider = document.getElementById('sens-slider') as HTMLInputElement;
    const sensVal = document.getElementById('sens-val')!;
    sensSlider.addEventListener('input', () => {
      const value = parseFloat(sensSlider.value);
      sensVal.textContent = value.toFixed(1);
      this.ctx.updateSensitivity(value);
    });

    const speedSlider = document.getElementById('speed-slider') as HTMLInputElement;
    const speedVal = document.getElementById('speed-val')!;
    speedSlider.addEventListener('input', () => {
      const value = parseInt(speedSlider.value, 10);
      speedVal.textContent = String(value);
      this.ctx.updateSpeed(value);
    });

    const fovSlider = document.getElementById('fov-slider') as HTMLInputElement;
    const fovVal = document.getElementById('fov-val')!;
    fovSlider.addEventListener('input', () => {
      const value = parseInt(fovSlider.value, 10);
      fovVal.textContent = `${value}deg`;
      this.ctx.updateFov(value);
    });

    document.querySelectorAll('[data-quality]').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('[data-quality]').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        this.ctx.updateQuality(parseFloat((btn as HTMLElement).dataset.quality!));
      });
    });

    document.querySelectorAll('[data-shadow]').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('[data-shadow]').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        this.ctx.updateShadows((btn as HTMLElement).dataset.shadow === 'on');
      });
    });
  }
}
