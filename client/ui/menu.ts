export type GameState = 'menu' | 'sandbox' | 'playmenu' | 'playing' | 'paused';

export interface MenuCallbacks {
  onPlay: () => void;
  onPlayMenu: () => void;
  onSandbox: () => void;
  onQuit: () => void;
}

export class MainMenu {
  private container: HTMLElement;
  private callbacks: MenuCallbacks;
  private state: GameState = 'menu';

  constructor(callbacks: MenuCallbacks) {
    this.callbacks = callbacks;
    this.container = this._createContainer();
    document.body.appendChild(this.container);
  }

  private _createContainer(): HTMLElement {
    const div = document.createElement('div');
    div.id = 'main-menu';
    div.innerHTML = `
      <div class="menu-panel">
        <div class="menu-header">
          <h1>ISLAND ENGINE</h1>
          <span>Procedural World Generation</span>
        </div>
        <div class="menu-buttons">
          <button class="menu-btn menu-btn-primary" id="btn-play">
            <span class="btn-icon">▶</span>
            <span>Play</span>
          </button>
          <button class="menu-btn menu-btn-secondary" id="btn-sandbox">
            <span class="btn-icon">◐</span>
            <span>Sandbox Mode</span>
          </button>
          <button class="menu-btn menu-btn-ghost" id="btn-settings">
            <span class="btn-icon">⚙</span>
            <span>Settings</span>
          </button>
        </div>
        <div class="menu-footer">
          <span>WASD to move · Mouse to look · ESC for menu</span>
        </div>
      </div>
    `;
    
    div.querySelector('#btn-play')?.addEventListener('click', () => {
      this.callbacks.onPlayMenu();
    });
    
    div.querySelector('#btn-sandbox')?.addEventListener('click', () => {
      this.callbacks.onSandbox();
    });
    
    return div;
  }

  show(): void {
    this.container.classList.remove('hidden');
    this.state = 'menu';
  }

  hide(): void {
    this.container.classList.add('hidden');
  }

  getState(): GameState {
    return this.state;
  }

  destroy(): void {
    this.container.remove();
  }
}
