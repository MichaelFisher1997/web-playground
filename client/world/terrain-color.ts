import * as THREE from 'three';
import type { IslandType } from './islands.js';

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function lerpRGB(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

export interface TerrainColorInput {
  height: number;
  normalizedHeight: number;
  islandType?: IslandType;
  waterHeight: number;
  oceanDepth: number;
}

export function getTerrainColorRGB(input: TerrainColorInput): [number, number, number] {
  const { height, normalizedHeight, islandType, waterHeight, oceanDepth } = input;
  if (height < oceanDepth + 2) {
    const t = clamp01((height - oceanDepth) / 2);
    return lerpRGB([0x0d, 0x1f, 0x2e], [0x1a, 0x3d, 0x5c], t);
  }
  if (height < waterHeight - 1) {
    const t = clamp01((height - (waterHeight - 5)) / 4);
    return lerpRGB([0x1a, 0x3d, 0x5c], [0x8b, 0x73, 0x55], t * 0.5);
  }
  if (height < waterHeight + 0.5) {
    const t = clamp01((height - (waterHeight - 1)) / 1.5);
    return lerpRGB([0xc9, 0xa8, 0x6c], [0xe8, 0xd4, 0xa8], t);
  }
  if (height < waterHeight + 2) {
    const t = clamp01((height - (waterHeight + 0.5)) / 1.5);
    return lerpRGB([0xe8, 0xd4, 0xa8], [0x4a, 0x8c, 0x3f], t);
  }

  const nt = normalizedHeight;
  switch (islandType || 'tropical') {
    case 'tropical':
      if (nt < 0.2) return [0x4a, 0x8c, 0x3f];
      if (nt < 0.4) return [0x3a, 0x7a, 0x30];
      if (nt < 0.6) return [0x5a, 0x60, 0x50];
      if (nt < 0.8) return [0x8a, 0x88, 0x80];
      return [0xff, 0xff, 0xff];
    case 'rocky':
      if (nt < 0.2) return [0x5a, 0x6a, 0x50];
      if (nt < 0.5) return [0x6a, 0x6a, 0x60];
      return [0x8a, 0x88, 0x80];
    case 'sandy':
      if (nt < 0.3) return [0xd4, 0xc4, 0x9a];
      if (nt < 0.6) return [0xc4, 0xb4, 0x8a];
      return [0xa0, 0xa0, 0x90];
    default:
      return [0x4a, 0x8c, 0x3f];
  }
}

export function getTerrainColor(input: TerrainColorInput): THREE.Color {
  const [r, g, b] = getTerrainColorRGB(input);
  return new THREE.Color(r / 255, g / 255, b / 255);
}
