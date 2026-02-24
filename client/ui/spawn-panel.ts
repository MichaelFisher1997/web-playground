import * as THREE from 'three';

export interface SpawnPanelCallbacks {
  onSpawnShip: () => void;
  onSpawnModeChange: (active: boolean) => void;
}

export class SpawnPanel {
  private container: HTMLElement;
  private callbacks: SpawnPanelCallbacks;
  private spawnModeActive: boolean = false;
  private spawnButton: HTMLButtonElement | null = null;

  constructor(callbacks: SpawnPanelCallbacks) {
    this.callbacks = callbacks;
    this.container = this._createContainer();
    document.body.appendChild(this.container);
  }

  private _createContainer(): HTMLElement {
    const div = document.createElement('div');
    div.id = 'spawn-panel';
    div.className = 'spawn-panel hidden';
    div.innerHTML = `
      <div class="spawn-header">
        <span>Spawn Objects</span>
        <button class="spawn-close" id="spawn-close">×</button>
      </div>
      <div class="spawn-content">
        <div class="spawn-item" data-item="ship">
          <div class="spawn-item-icon">🚢</div>
          <div class="spawn-item-info">
            <div class="spawn-item-name">Sailing Ship</div>
            <div class="spawn-item-desc">Wooden sailboat with buoyancy</div>
          </div>
        </div>
      </div>
      <div class="spawn-hint" id="spawn-hint">
        Click <span class="spawn-mode-btn">Spawn Mode</span> then click on water
      </div>
      <button class="spawn-mode-button" id="spawn-mode-btn">
        <span class="spawn-mode-icon">🎯</span>
        <span class="spawn-mode-text">Spawn Mode: OFF</span>
      </button>
    `;

    div.querySelector('#spawn-close')?.addEventListener('click', () => this.hide());

    const shipItem = div.querySelector('.spawn-item[data-item="ship"]');
    shipItem?.addEventListener('click', () => {
      this.callbacks.onSpawnShip();
    });

    const modeBtn = div.querySelector('#spawn-mode-btn') as HTMLButtonElement;
    this.spawnButton = modeBtn;
    modeBtn?.addEventListener('click', () => {
      this.toggleSpawnMode();
    });

    return div;
  }

  toggleSpawnMode(forceState?: boolean): void {
    this.spawnModeActive = forceState !== undefined ? forceState : !this.spawnModeActive;
    this._updateSpawnModeUI();
    this.callbacks.onSpawnModeChange(this.spawnModeActive);
  }

  private _updateSpawnModeUI(): void {
    if (this.spawnButton) {
      const text = this.spawnButton.querySelector('.spawn-mode-text');
      if (text) {
        text.textContent = `Spawn Mode: ${this.spawnModeActive ? 'ON' : 'OFF'}`;
      }
      this.spawnButton.classList.toggle('active', this.spawnModeActive);
    }
    document.body.classList.toggle('spawn-cursor', this.spawnModeActive);
    
    const crosshair = document.getElementById('crosshair');
    if (crosshair) {
      crosshair.classList.toggle('spawn-active', this.spawnModeActive);
    }
  }

  isSpawnModeActive(): boolean {
    return this.spawnModeActive;
  }

  show(): void {
    this.container.classList.remove('hidden');
  }

  hide(): void {
    this.container.classList.add('hidden');
    if (this.spawnModeActive) {
      this.spawnModeActive = false;
      this._updateSpawnModeUI();
      this.callbacks.onSpawnModeChange(false);
    }
  }

  toggle(): void {
    this.container.classList.toggle('hidden');
  }

  isVisible(): boolean {
    return !this.container.classList.contains('hidden');
  }

  destroy(): void {
    this.container.remove();
  }
}
