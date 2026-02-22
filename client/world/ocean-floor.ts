import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Vertex shader
// ---------------------------------------------------------------------------
const FLOOR_VERT = /* glsl */`
  uniform float uTime;
  varying vec3  vWorldPos;
  varying float vDepth;

  void main() {
    vec3 pos = position;

    // Subtle animated ripple to simulate underwater movement
    float ripple = sin(pos.x * 0.022 + uTime * 0.11) * cos(pos.z * 0.022 + uTime * 0.09) * 0.20
                 + sin(pos.x * 0.058 + uTime * 0.18) * cos(pos.z * 0.052 + uTime * 0.14) * 0.07;
    pos.y += ripple;

    vWorldPos = (modelMatrix * vec4(pos, 1.0)).xyz;
    vDepth    = clamp(-vWorldPos.y / 35.0, 0.0, 1.0);

    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;

// ---------------------------------------------------------------------------
// Fragment shader — bright animated caustics + depth-tinted sand
// ---------------------------------------------------------------------------
const FLOOR_FRAG = /* glsl */`
  uniform float uTime;
  uniform vec3  uSunDir;

  varying vec3  vWorldPos;
  varying float vDepth;

  // ---- Value noise ----
  float hash(vec2 p) {
    p = fract(p * vec2(127.1, 311.7));
    p += dot(p, p + 19.19);
    return fract(p.x * p.y);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i),             hash(i + vec2(1,0)), u.x),
               mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), u.x), u.y);
  }

  // ---- Caustic pattern using Voronoi-style blending ----
  // Generates bright rings/blobs like real underwater light caustics
  float causticPat(vec2 uv) {
    // Domain warp for organic irregular shapes
    vec2 warp = vec2(
      vnoise(uv * 1.2 + vec2(1.7, 9.2)),
      vnoise(uv * 1.2 + vec2(8.3, 2.8))
    ) * 0.35;
    uv += warp;

    // FBM layering
    float n = vnoise(uv)         * 0.50
            + vnoise(uv * 2.1)   * 0.28
            + vnoise(uv * 4.5)   * 0.14
            + vnoise(uv * 9.2)   * 0.08;

    // Power curve: bright peaks, very dark troughs — mimics real caustic rings
    return pow(n, 2.2);
  }

  void main() {
    // ---- Sand colour gradient ----
    vec3 shallowSand = vec3(0.88, 0.80, 0.56);  // warm light sand
    vec3 midSand     = vec3(0.55, 0.48, 0.32);  // darker wet sand
    vec3 deepSand    = vec3(0.12, 0.10, 0.08);  // deep dark sediment
    vec3 sandColor   = mix(shallowSand, midSand,  smoothstep(0.0, 0.35, vDepth));
    sandColor        = mix(sandColor,   deepSand,  smoothstep(0.30, 1.0,  vDepth));

    // ---- Dual-sample caustics (min blend = sharp caustic rings) ----
    float t  = uTime * 0.20;
    vec2  xz = vWorldPos.xz;

    // Two layers scroll in different directions for complex interference pattern
    vec2 uvA = xz * 0.050 + vec2( t * 0.13,  t * 0.08);
    vec2 uvB = xz * 0.050 + vec2(-t * 0.08,  t * 0.11);

    // RGB chromatic split — water disperses light slightly differently per channel
    float sp = 0.022;
    float cR = min(causticPat(uvA + vec2( sp,  sp * 0.5)), causticPat(uvB + vec2( sp,  sp * 0.5)));
    float cG = min(causticPat(uvA),                        causticPat(uvB));
    float cB = min(causticPat(uvA - vec2( sp,  sp * 0.5)), causticPat(uvB - vec2( sp,  sp * 0.5)));
    vec3 causticsRGB = vec3(cR, cG, cB);

    // Caustics are brightest in shallow water and fade with depth
    float fade = 1.0 - smoothstep(0.0, 0.55, vDepth);
    // Strong intensity — needs to be visible through water layer
    causticsRGB *= fade * 4.5;

    // ---- Sun diffuse (flat ocean floor — normal is ~up) ----
    float sunD = max(dot(vec3(0.0, 1.0, 0.0), normalize(uSunDir)), 0.0) * 0.55 + 0.45;

    // ---- Combine ----
    vec3 col = sandColor * sunD;
    col += causticsRGB * 0.75;

    // Water column tint: shallow = slight teal tint, deep = heavy blue
    vec3 waterTint = vec3(0.02, 0.22, 0.50);
    col = mix(col, col * vec3(0.75, 0.95, 1.10), vDepth * 0.35);  // subtle teal boost
    col = mix(col, waterTint, vDepth * 0.50);

    col = clamp(col, 0.0, 1.0);
    gl_FragColor = vec4(col, 1.0);
  }
`;

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface OceanFloorConfig {
  size: number;
  depth: number;
}

export function createOceanFloor(config: Partial<OceanFloorConfig> = {}): THREE.Mesh {
  const { size = 500, depth = -30 } = config;

  const geometry = new THREE.PlaneGeometry(size, size, 64, 64);
  geometry.rotateX(-Math.PI / 2);

  const positions = geometry.attributes.position;
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i);
    const z = positions.getZ(i);
    const h = depth
      + Math.sin(x * 0.020) * Math.cos(z * 0.020) * 2.0
      + Math.sin(x * 0.050 + 1.5) * Math.cos(z * 0.050 + 0.5) * 0.8
      + Math.sin(x * 0.100 + 3.0) * Math.cos(z * 0.100 + 2.0) * 0.3;
    positions.setY(i, h);
  }
  positions.needsUpdate = true;
  geometry.computeVertexNormals();

  const uniforms = {
    uTime:   { value: 0 },
    uSunDir: { value: new THREE.Vector3(0.6, 0.8, 0.4).normalize() },
  };

  const material = new THREE.ShaderMaterial({
    vertexShader:   FLOOR_VERT,
    fragmentShader: FLOOR_FRAG,
    uniforms,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'oceanFloor';
  return mesh;
}

export function updateOceanFloor(
  floorMesh: THREE.Mesh,
  time: number,
  sunDirection?: THREE.Vector3,
): void {
  const u = (floorMesh.material as THREE.ShaderMaterial).uniforms;
  u.uTime.value = time;
  if (sunDirection) u.uSunDir.value.copy(sunDirection).normalize();
}
