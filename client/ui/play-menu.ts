import { DEFAULT_CONFIG, WorldConfig } from '../world/generator.js';

export interface PlayMenuCallbacks {
  onStart: (config: WorldConfig) => void;
  onBack: () => void;
}

export class PlayMenu {
  private container: HTMLElement;
  private callbacks: PlayMenuCallbacks;
  private selectedConfig: WorldConfig = { ...DEFAULT_CONFIG };

  private presets: Record<string, Partial<WorldConfig>> = {
    'Archipelago': DEFAULT_CONFIG,
    'Single Big Island': {
      islandCount: 1,
      minIslandSize: 180,
      maxIslandSize: 220,
      noiseFrequency: 1.2,
      noiseOctaves: 7,
      worldSize: 600,
      resolution: 200,
      fogDensity: 0.003,
    },
    'Endless Ocean': {
      islandCount: 0,
      waterHeight: 2.0,
      waveHeight: 1.8,
      waveSpeed: 1.2,
      worldSize: 2000,
      fogDensity: 0.001,
    },
    'Sparse Atolls': {
      islandCount: 15,
      minIslandSize: 10,
      maxIslandSize: 25,
      waterHeight: 0.5,
      noiseFrequency: 4.0,
      maxTerrainHeight: 15,
      fogDensity: 0.002,
    },
    'Mountainous': {
      islandCount: 5,
      minIslandSize: 50,
      maxIslandSize: 100,
      noiseFrequency: 3.5,
      noiseOctaves: 8,
      noisePersistence: 0.6,
      waterHeight: -2.0,
      maxTerrainHeight: 60,
      fogDensity: 0.005,
    },
    'Massive Archipelago': {
      islandCount: 25,
      minIslandSize: 40,
      maxIslandSize: 90,
      worldSize: 1000,
      noiseFrequency: 1.8,
      noiseOctaves: 5,
      resolution: 200,
      waterHeight: -1.5,
      maxTerrainHeight: 60,
      oceanDepth: -25,
      fogDensity: 0.002,
    },
    'Island Chain': {
      islandCount: 25,
      minIslandSize: 30,
      maxIslandSize: 60,
      worldSize: 1200,
      noiseFrequency: 2.2,
      resolution: 180,
      fogDensity: 0.002,
    }
  };

  constructor(callbacks: PlayMenuCallbacks) {
    this.callbacks = callbacks;
    this.container = this._createContainer();
    document.body.appendChild(this.container);
    this._bindEvents();
  }

  private _createContainer(): HTMLElement {
    const div = document.createElement('div');
    div.id = 'play-menu';
    div.className = 'play-menu hidden';
    div.innerHTML = `
      <div class="menu-panel">
        <div class="menu-header">
          <h1>SELECT WORLD</h1>
          <span>Choose a preset to explore</span>
        </div>
        
        <div class="preset-grid">
          ${this._createPresetCards()}
        </div>
        
        <div class="menu-buttons">
          <button class="menu-btn menu-btn-primary" id="btn-start-play">
            <span class="btn-icon">▶</span>
            <span>Start Adventure</span>
          </button>
          <button class="menu-btn menu-btn-ghost" id="btn-back">
            <span class="btn-icon">←</span>
            <span>Back</span>
          </button>
        </div>
        
        <div class="menu-footer">
          <span>WASD to move · Space to jump · Shift to sprint · Mouse to look</span>
        </div>
      </div>
    `;
    return div;
  }

  private _createPresetCards(): string {
    const presetData: Record<string, { icon: string; desc: string; difficulty: string }> = {
      'Archipelago': { icon: '🏝️', desc: 'Balanced islands scattered across the ocean', difficulty: 'Normal' },
      'Single Big Island': { icon: '🏔️', desc: 'One massive island to explore', difficulty: 'Easy' },
      'Endless Ocean': { icon: '🌊', desc: 'Open waters with nowhere to land', difficulty: 'Hard' },
      'Sparse Atolls': { icon: '🐚', desc: 'Many small islands dot the sea', difficulty: 'Normal' },
      'Mountainous': { icon: '⛰️', desc: 'Tall peaks with treacherous terrain', difficulty: 'Hard' },
      'Massive Archipelago': { icon: '🗺️', desc: 'Huge world with 25 islands', difficulty: 'Normal' },
      'Island Chain': { icon: '⛓️', desc: 'Islands connected in a chain', difficulty: 'Normal' },
    };

    return Object.entries(this.presets).map(([name, config], index) => {
      const data = presetData[name];
      const isSelected = index === 0 ? 'selected' : '';
      return `
        <div class="preset-card ${isSelected}" data-preset="${name}">
          <div class="preset-icon">${data.icon}</div>
          <div class="preset-name">${name}</div>
          <div class="preset-desc">${data.desc}</div>
          <div class="preset-stats">
            <span class="preset-stat">🏝️ ${config.islandCount ?? DEFAULT_CONFIG.islandCount} islands</span>
            <span class="preset-stat">📏 ${config.worldSize ?? DEFAULT_CONFIG.worldSize}m</span>
          </div>
          <div class="preset-difficulty ${data.difficulty.toLowerCase()}">${data.difficulty}</div>
        </div>
      `;
    }).join('');
  }

  private _bindEvents(): void {
    // Preset selection
    this.container.querySelectorAll('.preset-card').forEach(card => {
      card.addEventListener('click', () => {
        this.container.querySelectorAll('.preset-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        
        const presetName = (card as HTMLElement).dataset.preset!;
        const preset = this.presets[presetName];
        this.selectedConfig = { ...DEFAULT_CONFIG, ...preset };
      });
    });

    // Start button
    this.container.querySelector('#btn-start-play')?.addEventListener('click', () => {
      this.callbacks.onStart(this.selectedConfig);
    });

    // Back button
    this.container.querySelector('#btn-back')?.addEventListener('click', () => {
      this.callbacks.onBack();
    });
  }

  show(): void {
    this.container.classList.remove('hidden');
    // Reset to first preset
    this.selectedConfig = { ...DEFAULT_CONFIG };
    this.container.querySelectorAll('.preset-card').forEach((c, i) => {
      c.classList.toggle('selected', i === 0);
    });
  }

  hide(): void {
    this.container.classList.add('hidden');
  }

  destroy(): void {
    this.container.remove();
  }
}
