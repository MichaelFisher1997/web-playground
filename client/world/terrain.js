import * as THREE from 'three';

// ── Simplex-like noise (deterministic, no deps) ───────────────────────────────
function hash(n) {
  n = Math.sin(n) * 43758.5453123;
  return n - Math.floor(n);
}

function noise2d(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  const a = hash(ix + iz * 57);
  const b = hash(ix + 1 + iz * 57);
  const c = hash(ix + (iz + 1) * 57);
  const d = hash(ix + 1 + (iz + 1) * 57);
  return a + (b - a) * ux + (c - a) * uz + (d - b - c + a + (b - a + c - a) * ux) * ux * uz;
}

function fbm(x, z, octaves = 6) {
  let val = 0, amp = 0.5, freq = 1, max = 0;
  for (let i = 0; i < octaves; i++) {
    val += noise2d(x * freq, z * freq) * amp;
    max += amp;
    amp *= 0.5;
    freq *= 2.1;
  }
  return val / max;
}

// ── Color ramp by height ──────────────────────────────────────────────────────
function heightColor(h, maxH) {
  const t = h / maxH;
  if (t < 0.02) return new THREE.Color(0xd4a84b); // sand wet
  if (t < 0.07) return new THREE.Color(0xe8c97a); // sand dry
  if (t < 0.30) return new THREE.Color(0x4a7c3f); // grass low
  if (t < 0.55) return new THREE.Color(0x3a6030); // grass mid
  if (t < 0.72) return new THREE.Color(0x5a6050); // rock base
  if (t < 0.85) return new THREE.Color(0x7a7870); // rock
  return new THREE.Color(0xd8d8d8);               // snow/peak
}

export function createTerrain(worldSize = 200, resolution = 180) {
  const geometry = new THREE.PlaneGeometry(worldSize, worldSize, resolution, resolution);
  geometry.rotateX(-Math.PI / 2);

  const positions = geometry.attributes.position;
  const count = positions.count;
  const colors = new Float32Array(count * 3);
  const cx = worldSize / 2;
  const cz = worldSize / 2;
  const ISLAND_R = worldSize * 0.30;
  const MAX_HEIGHT = 28;

  for (let i = 0; i < count; i++) {
    const x = positions.getX(i);
    const z = positions.getZ(i);

    const dx = x / cx, dz = z / cz;
    const distNorm = Math.sqrt(dx * dx + dz * dz);

    // Radial falloff — makes it an island shape
    const falloff = Math.max(0, 1 - Math.pow(distNorm / 0.85, 2.8));

    // FBM terrain height
    const nx = x / ISLAND_R * 1.5 + 0.3;
    const nz = z / ISLAND_R * 1.5 + 0.7;
    const raw = fbm(nx, nz, 7);

    // Apply falloff and height
    let h = (raw - 0.38) * 2.0 * falloff * MAX_HEIGHT;
    h = Math.max(h, -1.5); // water floor

    positions.setY(i, h);

    // Vertex colors
    const col = heightColor(Math.max(h, 0), MAX_HEIGHT);
    colors[i * 3]     = col.r;
    colors[i * 3 + 1] = col.g;
    colors[i * 3 + 2] = col.b;
  }

  positions.needsUpdate = true;
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();

  const material = new THREE.MeshLambertMaterial({
    vertexColors: true,
    flatShading: false,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.name = 'terrain';

  // Store heightmap for physics queries
  mesh.userData.resolution = resolution;
  mesh.userData.worldSize  = worldSize;
  mesh.userData.positions  = positions;

  return mesh;
}

/**
 * Sample height at (x, z) world coords from the terrain mesh.
 * Uses bilinear interpolation over the vertex grid.
 */
export function sampleHeight(terrain, x, z) {
  const { worldSize, resolution, positions } = terrain.userData;
  const half = worldSize / 2;
  // Clamp to terrain bounds
  const cx = Math.max(-half, Math.min(half, x));
  const cz = Math.max(-half, Math.min(half, z));
  // Normalized [0..1]
  const u = (cx + half) / worldSize;
  const v = (cz + half) / worldSize;
  // Grid cell indices
  const gx = u * resolution;
  const gz = v * resolution;
  const ix = Math.min(Math.floor(gx), resolution - 1);
  const iz = Math.min(Math.floor(gz), resolution - 1);
  const fx = gx - ix;
  const fz = gz - iz;

  const stride = resolution + 1;
  function idx(xi, zi) { return zi * stride + xi; }

  const h00 = positions.getY(idx(ix,     iz));
  const h10 = positions.getY(idx(ix + 1, iz));
  const h01 = positions.getY(idx(ix,     iz + 1));
  const h11 = positions.getY(idx(ix + 1, iz + 1));

  return h00 * (1 - fx) * (1 - fz)
       + h10 * fx       * (1 - fz)
       + h01 * (1 - fx) * fz
       + h11 * fx       * fz;
}
