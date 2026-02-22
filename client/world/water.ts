import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Vertex shader — simple sine waves, no Gerstner complexity
// ---------------------------------------------------------------------------
const WATER_VERT = /* glsl */`
  uniform float uTime;
  uniform float uWaveHeight;
  uniform float uWaveSpeed;

  varying vec3  vWorldPos;
  varying vec4  vScreenPos;
  varying float vWave;

  float wave(vec2 p, float freq, float speed, float phase) {
    return sin(p.x * freq + uTime * speed * uWaveSpeed + phase)
         * cos(p.y * freq * 0.8 + uTime * speed * 0.7 * uWaveSpeed + phase * 1.3);
  }

  void main() {
    vec3 pos = position;

    float w  = wave(pos.xz, 0.06,  0.5, 0.0)  * 0.50;
          w += wave(pos.xz, 0.11,  0.8, 1.4)  * 0.28;
          w += wave(pos.xz, 0.19,  1.2, 2.7)  * 0.14;
          w += wave(pos.xz, 0.35,  1.7, 4.1)  * 0.08;

    pos.y += w * uWaveHeight;
    vWave  = w * 0.5 + 0.5;  // [0..1]

    vWorldPos = (modelMatrix * vec4(pos, 1.0)).xyz;
    vec4 clip = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
    vScreenPos = clip;
    gl_Position = clip;
  }
`;

// ---------------------------------------------------------------------------
// Fragment shader — depth-based transparency, smooth normals
// ---------------------------------------------------------------------------
const WATER_FRAG = /* glsl */`
  uniform float uTime;
  uniform float uWaveSpeed;
  uniform vec3  uSunDir;
  uniform vec3  uCameraPos;
  uniform float uWaterHeight;
  uniform vec3  uSkyColorTop;
  uniform vec3  uSkyColorBottom;
  uniform sampler2D uDepthTex;
  uniform sampler2D uSceneTex;
  uniform float uCameraNear;
  uniform float uCameraFar;

  uniform int   uIslandCount;
  uniform vec3  uIslandCenters[6];
  uniform float uIslandRadii[6];

  varying vec3  vWorldPos;
  varying vec4  vScreenPos;
  varying float vWave;

  // ---- linearise depth buffer value to view-space distance ----
  float linearDepth(float d) {
    float n = uCameraNear;
    float f = uCameraFar;
    // Standard OpenGL linearization: returns view-space depth (positive = in front)
    return (2.0 * n * f) / (f + n - (d * 2.0 - 1.0) * (f - n));
  }

  // ---- smooth value noise (no grid artefacts) ----
  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = fract(sin(dot(i,             vec2(127.1, 311.7))) * 43758.5453);
    float b = fract(sin(dot(i + vec2(1,0), vec2(127.1, 311.7))) * 43758.5453);
    float c = fract(sin(dot(i + vec2(0,1), vec2(127.1, 311.7))) * 43758.5453);
    float d = fract(sin(dot(i + vec2(1,1), vec2(127.1, 311.7))) * 43758.5453);
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }

  // ---- surface normal from noise height field ----
  vec3 waterNormal(vec2 xz) {
    float t   = uTime * uWaveSpeed;
    float eps = 1.4;

    vec2 s1 = xz * 0.025;
    vec2 s2 = xz * 0.052;
    vec2 d1 = vec2(t * 0.14,  t * 0.09);
    vec2 d2 = vec2(-t * 0.10, t * 0.16);

    float hL = vnoise(s1 + d1 + vec2(-eps, 0)) * 0.65 + vnoise(s2 + d2 + vec2(-eps, 0)) * 0.35;
    float hR = vnoise(s1 + d1 + vec2( eps, 0)) * 0.65 + vnoise(s2 + d2 + vec2( eps, 0)) * 0.35;
    float hD = vnoise(s1 + d1 + vec2(0, -eps)) * 0.65 + vnoise(s2 + d2 + vec2(0, -eps)) * 0.35;
    float hU = vnoise(s1 + d1 + vec2(0,  eps)) * 0.65 + vnoise(s2 + d2 + vec2(0,  eps)) * 0.35;

    return normalize(vec3(hL - hR, 2.8, hD - hU));
  }

  // ---- shore proximity [0=open water, 1=right at shore] ----
  float shoreProximity(vec2 xz) {
    float closest = 1.0e6;
    for (int i = 0; i < 6; i++) {
      if (i >= uIslandCount) break;
      float d = length(xz - uIslandCenters[i].xz) - uIslandRadii[i];
      closest = min(closest, d);
    }
    return 1.0 - smoothstep(0.0, 30.0, closest);
  }

  void main() {
    vec2 screenUV = (vScreenPos.xy / vScreenPos.w) * 0.5 + 0.5;

    // ---- Surface normal ----
    vec3 N = waterNormal(vWorldPos.xz);

    // ---- Depth-based water column thickness ----
    // depthDiff = how many world units of water are below this surface pixel
    float rawD   = texture2D(uDepthTex, screenUV).r;
    float sceneZ = linearDepth(rawD);
    float waterZ = linearDepth(gl_FragCoord.z);
    float depthDiff = max(sceneZ - waterZ, 0.0);

    // Guard: if depth texture returned far plane (1.0) or invalid, cap the diff
    // rawD == 1.0 means "no geometry behind" — treat as very deep water but
    // still allow some transparency so the ocean floor can show through when
    // the depth texture IS working.
    float farMask = step(rawD, 0.9999);  // 0 when depth=1 (no geometry), 1 otherwise
    depthDiff *= farMask;
    // Add a small baseline depth so even "no geometry" pixels aren't 100% clear
    depthDiff = max(depthDiff, farMask == 0.0 ? 25.0 : 0.0);

    // ---- Refracted scene colour (slight wobble from normals) ----
    vec2 wob      = N.xz * 0.012;
    vec3 sceneCol = texture2D(uSceneTex, clamp(screenUV + wob, 0.001, 0.999)).rgb;

    // ---- Depth extinction: shallow → transparent, deep → opaque ----
    // k = extinction coefficient — lower = see deeper
    float k         = 0.15;
    float depthFade = 1.0 - exp(-depthDiff * k);
    depthFade       = clamp(depthFade, 0.0, 1.0);

    // ---- Water colour ----
    // Reference palette: bright tropical teal in shallows, deep navy in deep
    vec3 shallowCol = vec3(0.10, 0.82, 0.78);   // vivid tropical cyan
    vec3 midCol     = vec3(0.03, 0.50, 0.68);   // mid-depth teal-blue
    vec3 deepCol    = vec3(0.01, 0.14, 0.32);   // deep ocean navy

    vec3 waterCol = mix(shallowCol, midCol,  smoothstep(0.0, 0.45, depthFade));
    waterCol      = mix(waterCol,   deepCol, smoothstep(0.40, 1.0, depthFade));

    // Transmit tinted scene through water — teal tint on refracted view
    vec3 tint    = vec3(0.50, 0.92, 0.95);
    vec3 baseCol = mix(sceneCol * tint, waterCol, depthFade * 0.85);

    // ---- Lighting ----
    vec3 V = normalize(uCameraPos - vWorldPos);
    vec3 L = normalize(uSunDir);
    vec3 H = normalize(L + V);

    float wrap = max(dot(N, L), 0.0) * 0.6 + 0.4;
    // Primary specular — sharp sun glint
    float spec = pow(max(dot(N, H), 0.0), 180.0) * 3.5;
    // Secondary wider gloss
    float spec2 = pow(max(dot(N, H), 0.0), 40.0) * 0.4;

    // ---- Fresnel ----
    float cosV   = max(dot(N, V), 0.0);
    float fresnel = 0.04 + 0.96 * pow(1.0 - cosV, 5.0);

    // ---- Sky reflection ----
    vec3 Rv   = reflect(-V, N);
    float skyT = clamp(Rv.y * 0.5 + 0.5, 0.0, 1.0);
    vec3 skyR  = mix(uSkyColorBottom, uSkyColorTop, skyT * skyT) * 0.90;
    baseCol    = mix(baseCol, skyR, fresnel * 0.60);

    // ---- Diffuse + specular ----
    baseCol *= wrap;
    baseCol += (spec + spec2) * vec3(1.0, 0.97, 0.85);
    baseCol  = clamp(baseCol, 0.0, 1.5);

    // ---- Shore foam ----
    float shore    = shoreProximity(vWorldPos.xz);
    // Edge foam — where water surface meets shallow geometry
    float edgeFoam = 1.0 - smoothstep(0.0, 2.5, depthDiff);
    float waveFoam = smoothstep(0.78, 0.94, vWave);
    float foamMask = max(max(waveFoam, edgeFoam * 0.85), shore * 0.60 * smoothstep(0.38, 0.65, vWave));

    // Foam noise — smooth vnoise, no grid
    vec2 fuv = vWorldPos.xz * 0.052 + vec2(uTime * 0.04, uTime * 0.022) * uWaveSpeed;
    float fn = vnoise(fuv) * 0.55 + vnoise(fuv * 2.1) * 0.30 + vnoise(fuv * 4.5) * 0.15;
    fn = smoothstep(0.38, 0.68, fn);
    foamMask *= fn;

    baseCol = mix(baseCol, vec3(0.93, 0.98, 1.00), clamp(foamMask * 0.80, 0.0, 1.0));

    // ---- Alpha ----
    // Shallow water: quite transparent so floor is visible
    // Deep water: more opaque
    float alpha = mix(0.08, 0.90, depthFade);
    alpha = mix(alpha, 1.0, fresnel * 0.50);
    alpha = max(alpha, foamMask * 0.88);
    alpha = clamp(alpha, 0.0, 1.0);

    gl_FragColor = vec4(baseCol, alpha);
  }
`;

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface WaterConfig {
  size: number;
  waterHeight: number;
  waveHeight: number;
  waveSpeed: number;
  skyColorTop?: THREE.Color;
  skyColorBottom?: THREE.Color;
  islandCenters?: Array<{ x: number; z: number }>;
  islandRadii?: number[];
}

export function createWater(config: Partial<WaterConfig> = {}): THREE.Mesh {
  const {
    size         = 500,
    waterHeight  = -1.0,
    waveHeight   = 1.2,
    waveSpeed    = 0.7,
    skyColorTop    = new THREE.Color(0x2a6fad),
    skyColorBottom = new THREE.Color(0x8ec5d6),
    islandCenters  = [],
    islandRadii    = [],
  } = config;

  const geometry = new THREE.PlaneGeometry(size, size, 96, 96);
  geometry.rotateX(-Math.PI / 2);

  const MAX_ISLANDS = 6;
  const centerVecs: THREE.Vector3[] = [];
  const radii: number[] = [];
  for (let i = 0; i < MAX_ISLANDS; i++) {
    if (i < islandCenters.length) {
      centerVecs.push(new THREE.Vector3(islandCenters[i].x, 0, islandCenters[i].z));
      radii.push(islandRadii[i] ?? 0);
    } else {
      centerVecs.push(new THREE.Vector3(0, 0, 0));
      radii.push(0);
    }
  }

  const uniforms = {
    uTime:           { value: 0 },
    uWaveHeight:     { value: waveHeight },
    uWaveSpeed:      { value: waveSpeed },
    uSunDir:         { value: new THREE.Vector3(0.6, 0.8, 0.4).normalize() },
    uCameraPos:      { value: new THREE.Vector3() },
    uWaterHeight:    { value: waterHeight },
    uSkyColorTop:    { value: skyColorTop.clone() },
    uSkyColorBottom: { value: skyColorBottom.clone() },
    uDepthTex:       { value: null as THREE.Texture | null },
    uSceneTex:       { value: null as THREE.Texture | null },
    uCameraNear:     { value: 0.1 },
    uCameraFar:      { value: 1500.0 },
    uIslandCount:    { value: Math.min(islandCenters.length, MAX_ISLANDS) },
    uIslandCenters:  { value: centerVecs },
    uIslandRadii:    { value: radii },
  };

  const material = new THREE.ShaderMaterial({
    vertexShader:   WATER_VERT,
    fragmentShader: WATER_FRAG,
    uniforms,
    transparent:    true,
    depthWrite:     false,
    side:           THREE.FrontSide,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.y = waterHeight;
  mesh.renderOrder = 10;
  mesh.name = 'water';
  return mesh;
}

export function updateWater(
  waterMesh: THREE.Mesh,
  time: number,
  cameraPosition: THREE.Vector3,
  sunDirection?: THREE.Vector3,
  depthTexture?: THREE.Texture,
  sceneTexture?: THREE.Texture,
  camera?: THREE.PerspectiveCamera,
): void {
  const u = (waterMesh.material as THREE.ShaderMaterial).uniforms;
  u.uTime.value = time;
  u.uCameraPos.value.copy(cameraPosition);
  if (sunDirection) u.uSunDir.value.copy(sunDirection).normalize();
  if (depthTexture) u.uDepthTex.value = depthTexture;
  if (sceneTexture) u.uSceneTex.value = sceneTexture;
  if (camera) {
    u.uCameraNear.value = camera.near;
    u.uCameraFar.value  = camera.far;
  }
}

export function resizeWaterUniforms(waterMesh: THREE.Mesh, _w: number, _h: number): void {
  // reserved for future use
}

export function setWaterParams(
  waterMesh: THREE.Mesh,
  params: {
    waveHeight?: number;
    waveSpeed?: number;
    waterHeight?: number;
    skyColorTop?: THREE.Color;
    skyColorBottom?: THREE.Color;
    islandCenters?: Array<{ x: number; z: number }>;
    islandRadii?: number[];
  }
): void {
  const u = (waterMesh.material as THREE.ShaderMaterial).uniforms;
  if (params.waveHeight  !== undefined) u.uWaveHeight.value = params.waveHeight;
  if (params.waveSpeed   !== undefined) u.uWaveSpeed.value  = params.waveSpeed;
  if (params.skyColorTop    !== undefined) u.uSkyColorTop.value.copy(params.skyColorTop);
  if (params.skyColorBottom !== undefined) u.uSkyColorBottom.value.copy(params.skyColorBottom);
  if (params.waterHeight !== undefined) {
    u.uWaterHeight.value = params.waterHeight;
    waterMesh.position.y = params.waterHeight;
  }
  if (params.islandCenters !== undefined) {
    const MAX_ISLANDS = 6;
    u.uIslandCount.value = Math.min(params.islandCenters.length, MAX_ISLANDS);
    for (let i = 0; i < MAX_ISLANDS; i++) {
      if (i < params.islandCenters.length) {
        u.uIslandCenters.value[i].set(params.islandCenters[i].x, 0, params.islandCenters[i].z);
        u.uIslandRadii.value[i] = params.islandRadii?.[i] ?? 0;
      }
    }
  }
}
