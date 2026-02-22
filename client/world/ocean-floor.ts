import * as THREE from 'three';

export interface OceanFloorConfig {
  size: number;
  depth: number;
}

export function createOceanFloor(config: Partial<OceanFloorConfig> = {}): THREE.Mesh {
  const { size = 500, depth = -30 } = config;
  
  // Ocean floor geometry - simple plane with some noise
  const geometry = new THREE.PlaneGeometry(size, size, 64, 64);
  geometry.rotateX(-Math.PI / 2);

  // Add some subtle undulation to the ocean floor
  const positions = geometry.attributes.position;
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i);
    const z = positions.getZ(i);
    
    // Create gentle rolling hills on the ocean floor
    const noise1 = Math.sin(x * 0.02) * Math.cos(z * 0.02) * 2;
    const noise2 = Math.sin(x * 0.05 + 1.5) * Math.cos(z * 0.05 + 0.5) * 0.8;
    const noise3 = Math.sin(x * 0.1 + 3) * Math.cos(z * 0.1 + 2) * 0.3;
    
    const height = depth + noise1 + noise2 + noise3;
    positions.setY(i, height);
  }
  
  positions.needsUpdate = true;
  geometry.computeVertexNormals();

  // Sand colors - gradient from shallow (light) to deep (dark)
  const colors = new Float32Array(positions.count * 3);
  for (let i = 0; i < positions.count; i++) {
    const h = positions.getY(i);
    
    // Distance from water level (assuming water at ~0 to -5)
    const distFromWater = Math.abs(h + 2); // Assuming average water at -2
    const t = Math.min(1, Math.max(0, distFromWater / 25)); // Normalize
    
    // Light sand (shallow) to dark sand (deep)
    const shallowR = 0.76, shallowG = 0.70, shallowB = 0.50;
    const deepR = 0.15, deepG = 0.13, deepB = 0.10;
    
    const r = shallowR * (1 - t) + deepR * t;
    const g = shallowG * (1 - t) + deepG * t;
    const b = shallowB * (1 - t) + deepB * t;
    
    colors[i * 3] = r;
    colors[i * 3 + 1] = g;
    colors[i * 3 + 2] = b;
  }
  
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const material = new THREE.MeshLambertMaterial({
    vertexColors: true,
    flatShading: true,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'oceanFloor';

  return mesh;
}
