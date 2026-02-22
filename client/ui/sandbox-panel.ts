import { DEFAULT_CONFIG, WorldConfig } from '../world/generator.js';

export interface SandboxCallbacks {
  onGenerate: (config: Partial<WorldConfig>) => void;
  onRandomSeed: () => number;
}

export class SandboxPanel {
  private container: HTMLElement;
  private callbacks: SandboxCallbacks;
  private config: WorldConfig;
  private inputs: Map<string, HTMLInputElement> = new Map();
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(callbacks: SandboxCallbacks) {
    this.callbacks = callbacks;
    this.config = { ...DEFAULT_CONFIG };
    this.container = this._createContainer();
    document.body.appendChild(this.container);
  }

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

  private _createContainer(): HTMLElement {
    const div = document.createElement('div');
    div.id = 'sandbox-panel';
    div.className = 'sandbox-panel hidden';
    div.innerHTML = `
      <div class="sandbox-header">
        <h2>World Generation</h2>
        <button class="sandbox-close" id="sandbox-close">×</button>
      </div>
      
      <div class="sandbox-content">
        <div class="sandbox-section">
          <div class="section-title">Presets</div>
          <div class="sandbox-row">
            <select id="preset-select" class="preset-dropdown">
              <option value="Archipelago">Archipelago (Default)</option>
              <option value="Single Big Island">Single Big Island</option>
              <option value="Endless Ocean">Endless Ocean</option>
              <option value="Sparse Atolls">Sparse Atolls</option>
              <option value="Mountainous">Mountainous</option>
              <option value="Massive Archipelago">Massive Archipelago (50 islands!)</option>
              <option value="Island Chain">Island Chain (25 islands)</option>
            </select>
          </div>
        </div>

        <div class="sandbox-section">
          <div class="section-title" title="Global settings that affect the entire simulation">World <span class="help-icon">?</span></div>
          
          <div class="sandbox-row" title="The base value used to generate the random terrain. Same seed = same world.">
            <label>Seed</label>
            <div class="seed-input-group">
              <input type="text" id="input-seed" value="${this.config.seed}" />
              <button class="btn-icon-small" id="btn-random-seed" title="Randomize Seed">🎲</button>
            </div>
          </div>
          
          <div class="sandbox-row" title="The total dimensions of the generated map area. Larger = more islands can fit.">
            <label>World Size</label>
            <input type="range" id="input-worldSize" min="200" max="5000" step="100" value="${this.config.worldSize}" />
            <span class="val" id="val-worldSize">${this.config.worldSize}</span>
          </div>
          
          <div class="sandbox-row" title="Terrain mesh detail. Higher = smoother terrain but slower generation.">
            <label>Resolution</label>
            <input type="range" id="input-resolution" min="60" max="600" step="30" value="${this.config.resolution}" />
            <span class="val" id="val-resolution">${this.config.resolution}</span>
          </div>
        </div>
        
        <div class="sandbox-section">
          <div class="section-title" title="Settings for how islands are placed and sized">Islands <span class="help-icon">?</span></div>
          
          <div class="sandbox-row" title="Target number of islands to generate. More = longer generation time.">
            <label>Count</label>
            <input type="range" id="input-islandCount" min="0" max="100" step="1" value="${this.config.islandCount}" />
            <span class="val" id="val-islandCount">${this.config.islandCount}</span>
          </div>
          
          <div class="sandbox-row" title="Smallest possible radius for an island.">
            <label>Min Size</label>
            <input type="range" id="input-minIslandSize" min="10" max="60" step="5" value="${this.config.minIslandSize}" />
            <span class="val" id="val-minIslandSize">${this.config.minIslandSize}</span>
          </div>
          
          <div class="sandbox-row" title="Largest possible radius for an island.">
            <label>Max Size</label>
            <input type="range" id="input-maxIslandSize" min="40" max="400" step="5" value="${this.config.maxIslandSize}" />
            <span class="val" id="val-maxIslandSize">${this.config.maxIslandSize}</span>
          </div>
        </div>
        
        <div class="sandbox-section">
          <div class="section-title" title="Parameters for the Fractal Brownian Motion (FBM) noise used for terrain height">Terrain Noise <span class="help-icon">?</span></div>
          
          <div class="sandbox-row" title="How zoomed in/out the terrain features are. Higher = more frequent hills/valleys.">
            <label>Frequency</label>
            <input type="range" id="input-noiseFrequency" min="0.5" max="6" step="0.1" value="${this.config.noiseFrequency}" />
            <span class="val" id="val-noiseFrequency">${this.config.noiseFrequency.toFixed(1)}</span>
          </div>
          
          <div class="sandbox-row" title="Number of noise layers added together. Higher = more micro-details and crags.">
            <label>Octaves</label>
            <input type="range" id="input-noiseOctaves" min="2" max="8" step="1" value="${this.config.noiseOctaves}" />
            <span class="val" id="val-noiseOctaves">${this.config.noiseOctaves}</span>
          </div>
          
          <div class="sandbox-row" title="How much detail is added in each subsequent octave. Higher = sharper, more chaotic details.">
            <label>Lacunarity</label>
            <input type="range" id="input-noiseLacunarity" min="1.5" max="4" step="0.1" value="${this.config.noiseLacunarity}" />
            <span class="val" id="val-noiseLacunarity">${this.config.noiseLacunarity.toFixed(1)}</span>
          </div>
          
          <div class="sandbox-row" title="How much the smaller details affect the overall height. Higher = rougher terrain.">
            <label>Persistence</label>
            <input type="range" id="input-noisePersistence" min="0.2" max="0.8" step="0.05" value="${this.config.noisePersistence}" />
            <span class="val" id="val-noisePersistence">${this.config.noisePersistence.toFixed(2)}</span>
          </div>
        </div>
        
        <div class="sandbox-section">
          <div class="section-title" title="Settings for the water shader and ocean level">Ocean <span class="help-icon">?</span></div>
          
          <div class="sandbox-row" title="Base elevation of the water plane. Higher values drown more terrain.">
            <label>Water Height</label>
            <input type="range" id="input-waterHeight" min="-5" max="5" step="0.5" value="${this.config.waterHeight}" />
            <span class="val" id="val-waterHeight">${this.config.waterHeight.toFixed(1)}</span>
          </div>
          
          <div class="sandbox-row" title="Vertical height of the water waves.">
            <label>Wave Height</label>
            <input type="range" id="input-waveHeight" min="0.2" max="3" step="0.1" value="${this.config.waveHeight}" />
            <span class="val" id="val-waveHeight">${this.config.waveHeight.toFixed(1)}</span>
          </div>
          
          <div class="sandbox-row" title="How fast the waves animate over time.">
            <label>Wave Speed</label>
            <input type="range" id="input-waveSpeed" min="0.2" max="2" step="0.1" value="${this.config.waveSpeed}" />
            <span class="val" id="val-waveSpeed">${this.config.waveSpeed.toFixed(1)}</span>
          </div>
          
          <div class="sandbox-row" title="Atmospheric fog density. 0 = clear view, higher = more fog.">
            <label>Fog Density</label>
            <input type="range" id="input-fogDensity" min="0" max="0.02" step="0.001" value="${this.config.fogDensity}" />
            <span class="val" id="val-fogDensity">${this.config.fogDensity.toFixed(3)}</span>
          </div>
        </div>
      </div>
      
      <div class="sandbox-actions">
        <button class="sandbox-btn sandbox-btn-secondary" id="btn-reset">Reset Defaults</button>
        <button class="sandbox-btn sandbox-btn-primary" id="btn-save-preset">Save JSON Preset</button>
      </div>
    `;

    this._bindInputs(div);
    
    div.querySelector('#sandbox-close')?.addEventListener('click', () => this.hide());
    div.querySelector('#btn-reset')?.addEventListener('click', () => this._resetDefaults());
    div.querySelector('#btn-save-preset')?.addEventListener('click', () => this._savePreset());
    div.querySelector('#btn-random-seed')?.addEventListener('click', () => {
      const seed = this.callbacks.onRandomSeed();
      const input = this.inputs.get('seed');
      if (input) input.value = String(seed);
      this.config.seed = seed;
      this._scheduleGenerate();
    });

    const presetSelect = div.querySelector('#preset-select') as HTMLSelectElement;
    if (presetSelect) {
      presetSelect.addEventListener('change', (e) => {
        const val = (e.target as HTMLSelectElement).value;
        this._loadPreset(val);
      });
    }

    return div;
  }

  private _bindInputs(container: HTMLElement): void {
    const inputIds = [
      'seed', 'worldSize', 'resolution', 'islandCount', 'minIslandSize', 'maxIslandSize',
      'noiseFrequency', 'noiseOctaves', 'noiseLacunarity', 'noisePersistence',
      'waterHeight', 'waveHeight', 'waveSpeed', 'fogDensity'
    ];

    for (const id of inputIds) {
      const input = container.querySelector(`#input-${id}`) as HTMLInputElement;
      if (input) {
        this.inputs.set(id, input);
        input.addEventListener('input', () => this._onInputChanged(id));
      }
    }
  }

  private _onInputChanged(id: string): void {
    const input = this.inputs.get(id);
    if (!input) return;

    const valEl = this.container.querySelector(`#val-${id}`);
    let value: string | number = input.value;

    switch (id) {
      case 'seed':
        this.config.seed = isNaN(Number(input.value)) ? input.value : Number(input.value);
        break;
      case 'worldSize':
        this.config.worldSize = parseInt(input.value, 10);
        if (valEl) valEl.textContent = String(this.config.worldSize);
        break;
      case 'resolution':
        this.config.resolution = parseInt(input.value, 10);
        if (valEl) valEl.textContent = String(this.config.resolution);
        break;
      case 'islandCount':
        this.config.islandCount = parseInt(input.value, 10);
        if (valEl) valEl.textContent = String(this.config.islandCount);
        break;
      case 'minIslandSize':
        this.config.minIslandSize = parseInt(input.value, 10);
        if (valEl) valEl.textContent = String(this.config.minIslandSize);
        break;
      case 'maxIslandSize':
        this.config.maxIslandSize = parseInt(input.value, 10);
        if (valEl) valEl.textContent = String(this.config.maxIslandSize);
        break;
      case 'noiseOctaves':
        this.config.noiseOctaves = parseInt(input.value, 10);
        if (valEl) valEl.textContent = String(this.config.noiseOctaves);
        break;
      case 'noiseFrequency':
        this.config.noiseFrequency = parseFloat(input.value);
        if (valEl) valEl.textContent = this.config.noiseFrequency.toFixed(1);
        break;
      case 'noiseLacunarity':
        this.config.noiseLacunarity = parseFloat(input.value);
        if (valEl) valEl.textContent = this.config.noiseLacunarity.toFixed(1);
        break;
      case 'noisePersistence':
        this.config.noisePersistence = parseFloat(input.value);
        if (valEl) valEl.textContent = this.config.noisePersistence.toFixed(2);
        break;
      case 'waterHeight':
        this.config.waterHeight = parseFloat(input.value);
        if (valEl) valEl.textContent = this.config.waterHeight.toFixed(1);
        break;
      case 'waveHeight':
        this.config.waveHeight = parseFloat(input.value);
        if (valEl) valEl.textContent = this.config.waveHeight.toFixed(1);
        break;
      case 'waveSpeed':
        this.config.waveSpeed = parseFloat(input.value);
        if (valEl) valEl.textContent = this.config.waveSpeed.toFixed(1);
        break;
      case 'fogDensity':
        this.config.fogDensity = parseFloat(input.value);
        if (valEl) valEl.textContent = this.config.fogDensity.toFixed(3);
        break;
    }
    
    this._scheduleGenerate();
  }

  private _scheduleGenerate(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this._generate();
    }, 150);
  }

  private _savePreset(): void {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(this.config, null, 2));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href",     dataStr);
    downloadAnchorNode.setAttribute("download", `island-preset-${this.config.seed}.json`);
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
  }

  private _loadPreset(presetName: string): void {
    const preset = this.presets[presetName];
    if (preset) {
      // Keep current seed unless the preset specifies one (they don't)
      const currentSeed = this.config.seed;
      this.config = { ...DEFAULT_CONFIG, ...preset, seed: currentSeed };
      this._updateInputsFromConfig();
      this._generate();
    }
  }

  private _resetDefaults(): void {
    this.config = { ...DEFAULT_CONFIG };
    this._updateInputsFromConfig();
    // Also reset the preset dropdown to the default option
    const presetSelect = this.container.querySelector('#preset-select') as HTMLSelectElement;
    if (presetSelect) {
      presetSelect.value = 'Archipelago';
    }
    this._generate();
  }

  private _updateInputsFromConfig(): void {
    const mappings: Record<string, (val: unknown) => string> = {
      seed: (v) => String(v),
      worldSize: (v) => String(v),
      resolution: (v) => String(v),
      islandCount: (v) => String(v),
      minIslandSize: (v) => String(v),
      maxIslandSize: (v) => String(v),
      noiseFrequency: (v) => (v as number).toFixed(1),
      noiseOctaves: (v) => String(v),
      noiseLacunarity: (v) => (v as number).toFixed(1),
      noisePersistence: (v) => (v as number).toFixed(2),
      waterHeight: (v) => (v as number).toFixed(1),
      waveHeight: (v) => (v as number).toFixed(1),
      waveSpeed: (v) => (v as number).toFixed(1),
      fogDensity: (v) => (v as number).toFixed(3),
    };

    for (const [id, formatter] of Object.entries(mappings)) {
      const input = this.inputs.get(id);
      const valEl = this.container.querySelector(`#val-${id}`);
      const configVal = (this.config as unknown as Record<string, unknown>)[id];
      if (input) input.value = formatter(configVal);
      if (valEl) valEl.textContent = formatter(configVal);
    }
  }

  private _generate(): void {
    this.callbacks.onGenerate(this.config);
  }

  show(): void {
    this.container.classList.remove('hidden');
  }

  hide(): void {
    this.container.classList.add('hidden');
  }

  toggle(): void {
    this.container.classList.toggle('hidden');
  }

  isVisible(): boolean {
    return !this.container.classList.contains('hidden');
  }

  getConfig(): WorldConfig {
    return { ...this.config };
  }

  destroy(): void {
    this.container.remove();
  }
}
