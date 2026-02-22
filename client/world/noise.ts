export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function(): number {
    a |= 0;
    a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

export function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash);
}

export class SeededNoise {
  seed: number;
  rng: () => number;
  perm: number[];

  constructor(seed: number | string) {
    this.seed = typeof seed === 'string' ? hashString(seed) : (seed || 12345);
    this.rng = mulberry32(this.seed);
    this.perm = this._buildPermutation();
  }

  private _buildPermutation(): number[] {
    const p: number[] = [];
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [p[i], p[j]] = [p[j], p[i]];
    }
    return [...p, ...p];
  }

  reset(): void {
    this.rng = mulberry32(this.seed);
    this.perm = this._buildPermutation();
  }

  reseed(seed: number | string): void {
    this.seed = typeof seed === 'string' ? hashString(seed) : seed;
    this.reset();
  }

  private fade(t: number): number {
    return t * t * t * (t * (t * 6 - 15) + 10);
  }

  private lerp(a: number, b: number, t: number): number {
    return a + t * (b - a);
  }

  private grad(hash: number, x: number, y: number): number {
    const h = hash & 7;
    const u = h < 4 ? x : y;
    const v = h < 4 ? y : x;
    return ((h & 1) ? -u : u) + ((h & 2) ? -2 * v : 2 * v);
  }

  noise2D(x: number, y: number): number {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);
    const u = this.fade(xf);
    const v = this.fade(yf);
    const A = this.perm[X] + Y;
    const B = this.perm[X + 1] + Y;
    return this.lerp(
      this.lerp(this.grad(this.perm[A], xf, yf), this.grad(this.perm[B], xf - 1, yf), u),
      this.lerp(this.grad(this.perm[A + 1], xf, yf - 1), this.grad(this.perm[B + 1], xf - 1, yf - 1), u),
      v
    );
  }

  fbm(x: number, y: number, octaves: number = 6, lacunarity: number = 2.0, persistence: number = 0.5): number {
    let value = 0;
    let amplitude = 1;
    let frequency = 1;
    let maxValue = 0;

    for (let i = 0; i < octaves; i++) {
      value += this.noise2D(x * frequency, y * frequency) * amplitude;
      maxValue += amplitude;
      amplitude *= persistence;
      frequency *= lacunarity;
    }

    return value / maxValue;
  }

  ridgedNoise(x: number, y: number, octaves: number = 6, lacunarity: number = 2.0, persistence: number = 0.5): number {
    let value = 0;
    let amplitude = 1;
    let frequency = 1;
    let maxValue = 0;
    let weight = 1;

    for (let i = 0; i < octaves; i++) {
      let signal = this.noise2D(x * frequency, y * frequency);
      signal = 1.0 - Math.abs(signal);
      signal *= signal;
      signal *= weight;
      weight = Math.min(1, Math.max(0, signal * 2));
      value += signal * amplitude;
      maxValue += amplitude;
      amplitude *= persistence;
      frequency *= lacunarity;
    }

    return value / maxValue;
  }

  random(): number {
    return this.rng();
  }

  randomRange(min: number, max: number): number {
    return min + this.rng() * (max - min);
  }

  randomInt(min: number, max: number): number {
    return Math.floor(this.randomRange(min, max + 1));
  }
}
