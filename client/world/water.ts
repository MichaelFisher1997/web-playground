import * as THREE from 'three';

const WATER_VERT = /* glsl */`
  uniform float uTime;
  uniform float uWaveHeight;
  uniform float uWaveSpeed;
  varying vec2  vUv;
  varying vec3  vWorldPos;
  varying float vWave;

  float wave(vec2 p, float freq, float speed, float phase) {
    return sin(p.x * freq + uTime * speed * uWaveSpeed + phase)
         * cos(p.y * freq * 0.8 + uTime * speed * 0.7 * uWaveSpeed + phase * 1.3);
  }

  void main() {
    vUv = uv;
    vec3 pos = position;

    float w  = wave(pos.xz, 0.08,  0.6, 0.0)  * 0.5;
          w += wave(pos.xz, 0.13,  0.9, 1.4)  * 0.3;
          w += wave(pos.xz, 0.22,  1.3, 2.7)  * 0.15;
          w += wave(pos.xz, 0.40,  1.8, 4.1)  * 0.07;

    pos.y += w * uWaveHeight;
    vWave = (w + 1.0) * 0.5;

    vWorldPos = (modelMatrix * vec4(pos, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;

const WATER_FRAG = /* glsl */`
  uniform float uTime;
  uniform float uWaveSpeed;
  uniform vec3  uSunDir;
  uniform vec3  uCameraPos;
  uniform float uWaterHeight;

  varying vec2  vUv;
  varying vec3  vWorldPos;
  varying float vWave;

  vec3 waveNormal(vec2 p) {
    float eps = 0.5;
    float hL = sin((p.x - eps) * 0.08 + uTime * 0.6 * uWaveSpeed) * cos(p.y * 0.064 + uTime * 0.42 * uWaveSpeed) * 0.5
             + sin((p.x - eps) * 0.13 + uTime * 0.9 * uWaveSpeed) * cos(p.y * 0.104 + uTime * 0.63 * uWaveSpeed) * 0.3;
    float hR = sin((p.x + eps) * 0.08 + uTime * 0.6 * uWaveSpeed) * cos(p.y * 0.064 + uTime * 0.42 * uWaveSpeed) * 0.5
             + sin((p.x + eps) * 0.13 + uTime * 0.9 * uWaveSpeed) * cos(p.y * 0.104 + uTime * 0.63 * uWaveSpeed) * 0.3;
    float hD = sin(p.x * 0.08 + uTime * 0.6 * uWaveSpeed) * cos((p.y - eps) * 0.064 + uTime * 0.42 * uWaveSpeed) * 0.5
             + sin(p.x * 0.13 + uTime * 0.9 * uWaveSpeed) * cos((p.y - eps) * 0.104 + uTime * 0.63 * uWaveSpeed) * 0.3;
    float hU = sin(p.x * 0.08 + uTime * 0.6 * uWaveSpeed) * cos((p.y + eps) * 0.064 + uTime * 0.42 * uWaveSpeed) * 0.5
             + sin(p.x * 0.13 + uTime * 0.9 * uWaveSpeed) * cos((p.y + eps) * 0.104 + uTime * 0.63 * uWaveSpeed) * 0.3;
    return normalize(vec3(hL - hR, 2.0, hD - hU));
  }

  void main() {
    vec3 N = waveNormal(vWorldPos.xz);

    vec3 V = normalize(uCameraPos - vWorldPos);
    vec3 L = normalize(uSunDir);
    vec3 H = normalize(L + V);

    float diff = max(dot(N, L), 0.0) * 0.5 + 0.5;
    float spec = pow(max(dot(N, H), 0.0), 180.0) * 2.5;
    float fresnel = pow(1.0 - max(dot(N, V), 0.0), 3.0);

    vec3 deepColor    = vec3(0.02, 0.12, 0.28);
    vec3 shallowColor = vec3(0.05, 0.38, 0.45);
    vec3 foamColor    = vec3(0.75, 0.92, 0.98);

    float depth = smoothstep(0.35, 0.75, vWave);
    vec3 baseColor = mix(deepColor, shallowColor, depth);

    float foam = smoothstep(0.72, 0.85, vWave);
    baseColor = mix(baseColor, foamColor, foam * 0.4);

    vec3 skyColor = vec3(0.40, 0.68, 0.90);
    baseColor = mix(baseColor, skyColor * 0.6, fresnel * 0.45);

    vec3 sunColor = vec3(1.0, 0.9, 0.7);
    baseColor += spec * sunColor;
    baseColor *= diff;

    gl_FragColor = vec4(baseColor, 0.88);
  }
`;

export interface WaterConfig {
  size: number;
  waterHeight: number;
  waveHeight: number;
  waveSpeed: number;
}

export function createWater(config: Partial<WaterConfig> = {}): THREE.Mesh {
  const { size = 500, waterHeight = -1.0, waveHeight = 1.2, waveSpeed = 0.7 } = config;
  
  const geometry = new THREE.PlaneGeometry(size, size, 96, 96);
  geometry.rotateX(-Math.PI / 2);

  const uniforms = {
    uTime:       { value: 0 },
    uWaveHeight: { value: waveHeight },
    uWaveSpeed:  { value: waveSpeed },
    uSunDir:     { value: new THREE.Vector3(0.6, 0.8, 0.4).normalize() },
    uCameraPos:  { value: new THREE.Vector3() },
    uWaterHeight:{ value: waterHeight },
  };

  const material = new THREE.ShaderMaterial({
    vertexShader:   WATER_VERT,
    fragmentShader: WATER_FRAG,
    uniforms,
    transparent:    true,
    side:           THREE.FrontSide,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.y = waterHeight;
  mesh.renderOrder = 1;
  mesh.name = 'water';

  return mesh;
}

export function updateWater(
  waterMesh: THREE.Mesh, 
  time: number, 
  cameraPosition: THREE.Vector3
): void {
  const u = (waterMesh.material as THREE.ShaderMaterial).uniforms;
  u.uTime.value = time;
  u.uCameraPos.value.copy(cameraPosition);
}

export function setWaterParams(
  waterMesh: THREE.Mesh, 
  params: { waveHeight?: number; waveSpeed?: number; waterHeight?: number }
): void {
  const u = (waterMesh.material as THREE.ShaderMaterial).uniforms;
  if (params.waveHeight !== undefined) u.uWaveHeight.value = params.waveHeight;
  if (params.waveSpeed !== undefined) u.uWaveSpeed.value = params.waveSpeed;
  if (params.waterHeight !== undefined) {
    u.uWaterHeight.value = params.waterHeight;
    waterMesh.position.y = params.waterHeight;
  }
}
