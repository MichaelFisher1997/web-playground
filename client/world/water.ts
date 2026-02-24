import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Vertex shader — Gerstner waves (Y-only displacement to avoid fold artefacts)
// Returns crestFactor in vCrest for foam on wave peaks
// ---------------------------------------------------------------------------
const WATER_VERT = /* glsl */`
  uniform float uTime;
  uniform float uWaveHeight;
  uniform float uWaveSpeed;
  uniform int   uIslandCount;
  uniform vec3  uIslandCenters[6];
  uniform float uIslandRadii[6];

  varying vec3  vWorldPos;
  varying vec4  vScreenPos;
  varying float vCrest;      // Gerstner crest factor → drives wave-peak foam
  varying vec3  vWorldNormal; // Analytical wave normal

  // ---------------------------------------------------------------------------
  // Gerstner WavePoint — ported from WaterIncludes.cginc
  // Returns: xyz = displacement, w = crestFactor
  // We only USE .y for vertex position to avoid the fold/overlap bug,
  // but we accumulate .w (crest) and let the normal function use the full sum.
  // ---------------------------------------------------------------------------
  vec4 wavePoint(vec2 pos, float amplitude, float wavelength, float speed,
                 vec2 direction, float steepness, float fadeSpeed) {
    float frequency        = 2.0 / wavelength;
    float phaseConstant    = speed * 2.0 / wavelength;
    vec2  dir              = normalize(direction);
    float fi               = uTime * uWaveSpeed * phaseConstant;
    float dirDotPos        = dot(dir, pos);

    // Keep wave energy mostly stable; avoid full flatten cycles
    float fadeOsc = cos(fadeSpeed * uTime * uWaveSpeed) * 0.5 + 0.5;
    float fade    = 0.82 + fadeOsc * 0.18;
    float amp     = amplitude * fade * uWaveHeight;

    float c       = cos(frequency * dirDotPos + fi);
    float s       = sin(frequency * dirDotPos + fi);

    float dispX   = steepness * amp * dir.x * c;
    float dispY   = amp * s;
    float dispZ   = steepness * amp * dir.y * c;
    float crest   = s * clamp(steepness, 0.0, 1.0) * fade;

    return vec4(dispX, dispY, dispZ, crest);
  }

  // Analytical normal for one Gerstner wave (from GPU Gems Ch.1 derivative)
  vec3 waveNormal(vec3 pos, float amplitude, float wavelength, float speed,
                  vec2 direction, float steepness) {
    float frequency     = 2.0 / wavelength;
    float phaseConstant = speed * 2.0 / wavelength;
    vec2  dir           = normalize(direction);
    float fi            = uTime * uWaveSpeed * phaseConstant;
    float dirDotPos     = dot(dir, pos.xz);
    float WA            = frequency * amplitude * uWaveHeight;
    float S             = sin(frequency * dirDotPos + fi);
    float C             = cos(frequency * dirDotPos + fi);
    return vec3(
      dir.x * WA * C,
      clamp(steepness * WA * S, -0.50, 0.50),
      dir.y * WA * C
    );
  }

  // 0 near shoreline, 1 farther offshore.
  float shoreCalmFactor(vec2 xz) {
    float closest = 1.0e6;
    for (int i = 0; i < 6; i++) {
      if (i >= uIslandCount) break;
      float d = length(xz - uIslandCenters[i].xz) - uIslandRadii[i];
      closest = min(closest, d);
    }
    // Calm right at shore, recover wave energy quickly offshore.
    return smoothstep(1.0, 9.0, closest);
  }

  void main() {
    vec3 pos = position;
    vec3 worldPos = (modelMatrix * vec4(pos, 1.0)).xyz;

    // ---- 7 Gerstner waves (Y-only displacement) ----
    // World is 400 units wide — wavelengths must be proportionally large
    float totalCrest = 0.0;

    vec4 w1 = wavePoint(worldPos.xz, 1.15, 64.0, 0.9, vec2( 1.0,  0.2), 0.34, 0.8);
    vec4 w2 = wavePoint(worldPos.xz, 0.82, 42.0, 0.8, vec2(-0.6,  1.0), 0.26, 1.1);
    vec4 w3 = wavePoint(worldPos.xz, 0.58, 27.0, 1.2, vec2( 0.8, -0.5), 0.20, 0.6);
    vec4 w4 = wavePoint(worldPos.xz, 0.48, 16.0, 1.6, vec2(-0.3,  0.7), 0.16, 1.4);
    vec4 w5 = wavePoint(worldPos.xz, 0.38, 10.0, 2.0, vec2( 0.6,  0.5), 0.12, 1.0);
    vec4 w6 = wavePoint(worldPos.xz, 0.26,  6.8, 2.4, vec2(-0.8,  0.3), 0.10, 1.6);
    vec4 w7 = wavePoint(worldPos.xz, 0.18,  4.2, 3.0, vec2( 0.4, -0.9), 0.08, 1.2);

    // Smooth waves close to shoreline, keep stronger motion offshore.
    float calm = shoreCalmFactor(worldPos.xz);
    float nearshoreWaveScale = mix(0.45, 1.15, calm);

    // Only apply Y displacement (avoids geometry folding).
    worldPos.y += (w1.y + w2.y + w3.y + w4.y + w5.y + w6.y + w7.y) * 1.55 * nearshoreWaveScale;

    // Crest foam driver from shorter waves only.
    totalCrest = max(w4.w, 0.0) + max(w5.w, 0.0) + max(w6.w, 0.0) + max(w7.w, 0.0);
    // Slightly suppress crest generation right at shore so foam stays controlled.
    vCrest = clamp(totalCrest * 2.6 * mix(0.65, 1.0, calm), 0.0, 1.0);

    // Analytical normals accumulated then flipped to world-up convention
    vec3 nSum = vec3(0.0);
    nSum += waveNormal(worldPos, 1.15, 64.0, 0.9, vec2( 1.0,  0.2), 0.34);
    nSum += waveNormal(worldPos, 0.82, 42.0, 0.8, vec2(-0.6,  1.0), 0.26);
    nSum += waveNormal(worldPos, 0.58, 27.0, 1.2, vec2( 0.8, -0.5), 0.20);
    nSum += waveNormal(worldPos, 0.48, 16.0, 1.6, vec2(-0.3,  0.7), 0.16);
    nSum += waveNormal(worldPos, 0.38, 10.0, 2.0, vec2( 0.6,  0.5), 0.12);
    nSum += waveNormal(worldPos, 0.26,  6.8, 2.4, vec2(-0.8,  0.3), 0.10);
    nSum += waveNormal(worldPos, 0.18,  4.2, 3.0, vec2( 0.4, -0.9), 0.08);
    vWorldNormal = normalize(vec3(-nSum.x, 1.0 - nSum.y, -nSum.z));

    vWorldPos = worldPos;

    // Recompute clip from modified worldPos
    vec4 clip = projectionMatrix * viewMatrix * vec4(worldPos, 1.0);
    vScreenPos = clip;
    gl_Position = clip;
  }
`;

// ---------------------------------------------------------------------------
// Fragment shader — depth fog, intersection foam, SSS, crest foam
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
  uniform vec3  uWaterFogColor;
  uniform float uWaterFogDensity;
  uniform float uSSSPower;

  uniform int   uIslandCount;
  uniform vec3  uIslandCenters[6];
  uniform float uIslandRadii[6];

  varying vec3  vWorldPos;
  varying vec4  vScreenPos;
  varying float vCrest;
  varying vec3  vWorldNormal;

  // ---- linearise depth ----
  float linearDepth(float d) {
    float n = uCameraNear;
    float f = uCameraFar;
    return (2.0 * n * f) / (f + n - (d * 2.0 - 1.0) * (f - n));
  }

  // ---- smooth value noise ----
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

  // ---- fine-scale normal detail (simulates a scrolling normal map) ----
  // Multiple short-scale layers give local chop so highlights don't become
  // broad smooth blobs.
  vec3 detailNormal(vec2 xz, float t) {
    float eps = 0.18;
    // Layer 1 — medium chop
    vec2 s1 = xz * 1.40 + vec2(t * 0.30, t * 0.22);
    float h1L = vnoise(s1 + vec2(-eps, 0.0));
    float h1R = vnoise(s1 + vec2( eps, 0.0));
    float h1D = vnoise(s1 + vec2(0.0, -eps));
    float h1U = vnoise(s1 + vec2(0.0,  eps));
    vec3 n1 = normalize(vec3(h1L - h1R, 0.78, h1D - h1U));

    // Layer 2 — fine chop, different scroll direction
    vec2 s2 = xz * 2.85 + vec2(-t * 0.27, t * 0.37);
    float h2L = vnoise(s2 + vec2(-eps, 0.0));
    float h2R = vnoise(s2 + vec2( eps, 0.0));
    float h2D = vnoise(s2 + vec2(0.0, -eps));
    float h2U = vnoise(s2 + vec2(0.0,  eps));
    vec3 n2 = normalize(vec3(h2L - h2R, 0.85, h2D - h2U));

    // Layer 3 — very fine sparkly chop
    vec2 s3 = xz * 4.8 + vec2(t * 0.42, -t * 0.34);
    float h3L = vnoise(s3 + vec2(-eps, 0.0));
    float h3R = vnoise(s3 + vec2( eps, 0.0));
    float h3D = vnoise(s3 + vec2(0.0, -eps));
    float h3U = vnoise(s3 + vec2(0.0,  eps));
    vec3 n3 = normalize(vec3(h3L - h3R, 0.95, h3D - h3U));

    return normalize(n1 + n2 * 0.75 + n3 * 0.55);
  }

  // ---- shore distance ----
  float shoreDist(vec2 xz) {
    float closest = 1.0e6;
    for (int i = 0; i < 6; i++) {
      if (i >= uIslandCount) break;
      float d = length(xz - uIslandCenters[i].xz) - uIslandRadii[i];
      closest = min(closest, d);
    }
    return closest;
  }

  void main() {
    vec2 screenUV = (vScreenPos.xy / vScreenPos.w) * 0.5 + 0.5;
    float t = uTime * uWaveSpeed;
    float sd = shoreDist(vWorldPos.xz);
    float calmNearShore = smoothstep(1.0, 9.0, sd);

    // ---- Blend large Gerstner normal with fine detail normal ----
    vec3 gerstnerN = normalize(vWorldNormal);
    vec3 detailN   = detailNormal(vWorldPos.xz, t);
    // Keep large-wave silhouette from Gerstner, inject local chop from detail normal.
    // Reduce high-frequency chop near shore so water smooths out on the beach.
    float detailMix = mix(0.12, 0.78, calmNearShore);
    vec3 N = normalize(vec3(
      gerstnerN.x * (1.0 - detailMix) + detailN.x * detailMix,
      gerstnerN.y * (0.86 - detailMix * 0.36) + detailN.y * (0.14 + detailMix * 0.36),
      gerstnerN.z * (1.0 - detailMix) + detailN.z * detailMix
    ));

    // ---- Depth ----
    float rawD   = texture2D(uDepthTex, screenUV).r;
    float sceneZ = linearDepth(rawD);
    float waterZ = linearDepth(gl_FragCoord.z);
    float depthDiff = max(sceneZ - waterZ, 0.0);
    float farMask = step(rawD, 0.9999);
    depthDiff = depthDiff * farMask + (1.0 - farMask) * 30.0;

    // ---- Refraction ----
    vec2 uvOffset  = N.xz * 0.022 * clamp(depthDiff * 0.5, 0.0, 1.0) * mix(0.35, 1.0, calmNearShore);
    vec2 refractUV = clamp(screenUV + uvOffset, 0.001, 0.999);
    float refractRawD = texture2D(uDepthTex, refractUV).r;
    if (linearDepth(refractRawD) < waterZ) refractUV = screenUV;
    vec3 bgColor = texture2D(uSceneTex, refractUV).rgb;

    // ---- Depth fog ----
    float fogFactor = clamp(exp2(-uWaterFogDensity * depthDiff), 0.0, 1.0);
    vec3 colorBelow = mix(uWaterFogColor, bgColor, fogFactor);

    // ---- Water colour ----
    vec3 shallowCol = vec3(0.26, 0.88, 0.93);
    vec3 midCol     = vec3(0.08, 0.62, 0.86);
    vec3 deepCol    = vec3(0.02, 0.25, 0.60);
    float depthT    = clamp(1.0 - fogFactor, 0.0, 1.0);
    vec3 waterCol   = mix(shallowCol, midCol, smoothstep(0.0, 0.5, depthT));
    waterCol        = mix(waterCol, deepCol, smoothstep(0.45, 1.0, depthT));

    // ---- Lighting ----
    vec3 V  = normalize(uCameraPos - vWorldPos);
    vec3 L  = normalize(uSunDir);
    vec3 H  = normalize(L + V);

    float NdotL = max(dot(N, L), 0.0);
    float wrap  = NdotL * 0.55 + 0.45;

    // Sharp specular glint + noise gating to avoid broad plastic blobs
    float specCore = pow(max(dot(N, H), 0.0), 280.0);
    float specNoise = smoothstep(0.72, 0.88, vnoise(vWorldPos.xz * 1.35 + vec2(t * 0.24, -t * 0.21)));
    float spec = specCore * (0.45 + specNoise * 1.55) * 3.4;
    float specSoft = pow(max(dot(N, H), 0.0), 65.0) * 0.03;
    float glintNoise = smoothstep(0.82, 0.93, vnoise(vWorldPos.xz * 3.4 + vec2(t * 0.44, -t * 0.37)));
    float microGlints = glintNoise * pow(max(dot(N, H), 0.0), 120.0) * 0.9;

    // SSS — kept modest, uses camera-relative view direction
    float sssNdotL = 1.0 - max(dot(gerstnerN, L), 0.0); // use smooth Gerstner N for SSS
    float sssVdotN = max(dot(V, gerstnerN), 0.0);
    float sss      = sssNdotL * sssVdotN * 0.5 * uSSSPower; // removed VdotL which was too strong

    // ---- Fresnel + sky ----
    float cosV    = max(dot(N, V), 0.0);
    float fresnel = 0.04 + 0.96 * pow(1.0 - cosV, 5.0);
    vec3 Rv       = reflect(-V, N);
    float skyT    = clamp(Rv.y * 0.5 + 0.5, 0.0, 1.0);
    vec3 skyR     = mix(uSkyColorBottom, uSkyColorTop, skyT * skyT) * 0.88;

    // ---- Compose ----
    vec3 surfaceCol = waterCol;
    surfaceCol = mix(surfaceCol, skyR, fresnel * 0.36);
    surfaceCol *= wrap;
    surfaceCol += (spec + specSoft + microGlints) * vec3(1.0, 0.97, 0.88);
    surfaceCol += sss * shallowCol * 0.4;  // subtle SSS tint only
    // Fine luminance breakup so water doesn't read as one smooth gradient
    float rippleLum = vnoise(vWorldPos.xz * 2.8 + vec2(t * 0.24, -t * 0.20));
    surfaceCol *= 0.92 + (rippleLum - 0.5) * 0.24;

    float alpha = clamp(depthT * 0.82 + 0.08, 0.05, 0.90);
    alpha = mix(alpha, 1.0, fresnel * 0.40);
    vec3 finalCol = mix(colorBelow, surfaceCol, alpha);
    // Prevent overly dark shallow strip by biasing toward bright shallow tint.
    finalCol = mix(finalCol, shallowCol, (1.0 - depthT) * 0.28);

    // ---- Foam ----
    float shoreline = 1.0 - smoothstep(0.0, 11.0, sd);
    float shallowMask = 1.0 - smoothstep(0.35, 4.8, depthDiff);

    // Two shoreline bands: a tight breaker line and a softer backwash line.
    float surfBand = exp(-abs(sd - 0.55) * 2.8);
    float backwashBand = exp(-abs(sd - 1.75) * 2.0);

    // High-frequency breakup so foam looks like clustered patches, not blur.
    float nA = vnoise(vWorldPos.xz * 0.34 + vec2(t * 0.14, -t * 0.10));
    float nB = vnoise(vWorldPos.xz * 0.68 + vec2(-t * 0.20, t * 0.14));
    float foamTex = smoothstep(0.46, 0.74, nA * 0.58 + nB * 0.42);

    // Intersection foam (depth edge), constrained to shoreline + shallow zone.
    float intersectionFoam = (1.0 - smoothstep(0.0, 1.45, depthDiff)) * shoreline * shallowMask;
    intersectionFoam *= smoothstep(0.50, 0.84, nA);

    // Thin bright line at actual shoreline edge.
    float shorelineLine = exp(-abs(sd) * 5.8) * shallowMask;

    // Crest foam from short-wave peaks; mostly near shore, tiny amount offshore.
    float crestPeak = smoothstep(0.58, 0.86, vCrest);
    float crestNoise = smoothstep(0.62, 0.88, vnoise(vWorldPos.xz * 0.24 + vec2(-t * 0.12, t * 0.09)));
    float crestFoam = crestPeak * crestNoise * (shoreline * 0.46 + 0.08);

    // Main shoreline foam belt.
    float shoreFoam = (surfBand + backwashBand * 0.55) * foamTex * shoreline * shallowMask;

    float totalFoam = clamp(
      shorelineLine * 0.75 +
      intersectionFoam * 0.74 +
      shoreFoam * 0.92 +
      crestFoam * 0.12,
      0.0, 1.0
    );

    finalCol = mix(finalCol, vec3(0.94, 0.97, 1.00), totalFoam * 0.92);
    float finalAlpha = clamp(alpha + totalFoam * 0.58, 0.0, 1.0);

    gl_FragColor = vec4(finalCol, finalAlpha);
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

export function getWaterSurfaceHeight(
  x: number,
  z: number,
  time: number,
  waterHeight: number,
  waveHeight: number,
  waveSpeed: number,
  islands: Array<{ x: number; z: number; radius: number }>,
): number {
  const gerstner = (
    px: number,
    pz: number,
    amplitude: number,
    wavelength: number,
    speed: number,
    dirX: number,
    dirZ: number,
  ): number => {
    const frequency = 2.0 / wavelength;
    const phaseConstant = speed * 2.0 / wavelength;
    const len = Math.sqrt(dirX * dirX + dirZ * dirZ);
    const ndx = dirX / len;
    const ndz = dirZ / len;
    const fi = time * waveSpeed * phaseConstant;
    const dirDotPos = ndx * px + ndz * pz;
    return amplitude * Math.sin(frequency * dirDotPos + fi) * waveHeight;
  };

  let closest = 1e6;
  for (const island of islands) {
    const d = Math.sqrt((x - island.x) ** 2 + (z - island.z) ** 2) - island.radius;
    closest = Math.min(closest, d);
  }
  const calm = Math.max(0, Math.min(1, (closest - 1) / 8));
  const nearshoreScale = 0.45 + 0.7 * calm;

  const total = (
    gerstner(x, z, 1.15, 64.0, 0.9, 1.0, 0.2) +
    gerstner(x, z, 0.82, 42.0, 0.8, -0.6, 1.0) +
    gerstner(x, z, 0.58, 27.0, 1.2, 0.8, -0.5) +
    gerstner(x, z, 0.48, 16.0, 1.6, -0.3, 0.7) +
    gerstner(x, z, 0.38, 10.0, 2.0, 0.6, 0.5) +
    gerstner(x, z, 0.26, 6.8, 2.4, -0.8, 0.3) +
    gerstner(x, z, 0.18, 4.2, 3.0, 0.4, -0.9)
  ) * 1.55 * nearshoreScale;

  return waterHeight + total;
}

export function createWater(config: Partial<WaterConfig> = {}): THREE.Mesh {
  const {
    size           = 500,
    waterHeight    = -1.0,
    waveHeight     = 1.2,
    waveSpeed      = 0.7,
    skyColorTop    = new THREE.Color(0x2a6fad),
    skyColorBottom = new THREE.Color(0x8ec5d6),
    islandCenters  = [],
    islandRadii    = [],
  } = config;

  const geometry = new THREE.PlaneGeometry(size, size, 192, 192);
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
    // Water fog (depth extinction) — tropical warm teal fog colour
    uWaterFogColor:    { value: new THREE.Vector3(0.10, 0.58, 0.82) },
    uWaterFogDensity:  { value: 0.06 },   // low density → shallows stay bright and light
    // SSS
    uSSSPower:         { value: 1.8 },
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
