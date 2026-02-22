import * as THREE from 'three';

// ── Water ShaderMaterial ──────────────────────────────────────────────────────

const WATER_VERT = /* glsl */`
  uniform float uTime;
  uniform float uWaveHeight;
  varying vec2  vUv;
  varying vec3  vWorldPos;
  varying float vWave;

  float wave(vec2 p, float freq, float speed, float phase) {
    return sin(p.x * freq + uTime * speed + phase)
         * cos(p.y * freq * 0.8 + uTime * speed * 0.7 + phase * 1.3);
  }

  void main() {
    vUv = uv;
    vec3 pos = position;

    // Layered waves
    float w  = wave(pos.xz, 0.08,  0.6, 0.0)  * 0.5;
          w += wave(pos.xz, 0.13,  0.9, 1.4)  * 0.3;
          w += wave(pos.xz, 0.22,  1.3, 2.7)  * 0.15;
          w += wave(pos.xz, 0.40,  1.8, 4.1)  * 0.07;

    pos.y += w * uWaveHeight;
    vWave = (w + 1.0) * 0.5; // remap to [0,1]

    vWorldPos = (modelMatrix * vec4(pos, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;

const WATER_FRAG = /* glsl */`
  uniform float uTime;
  uniform vec3  uSunDir;
  uniform vec3  uCameraPos;

  varying vec2  vUv;
  varying vec3  vWorldPos;
  varying float vWave;

  // Approximate normal from wave gradient
  vec3 waveNormal(vec2 p) {
    float eps = 0.5;
    // finite difference
    float hL = sin((p.x - eps) * 0.08 + uTime * 0.6) * cos(p.y * 0.064 + uTime * 0.42) * 0.5
             + sin((p.x - eps) * 0.13 + uTime * 0.9) * cos(p.y * 0.104 + uTime * 0.63) * 0.3;
    float hR = sin((p.x + eps) * 0.08 + uTime * 0.6) * cos(p.y * 0.064 + uTime * 0.42) * 0.5
             + sin((p.x + eps) * 0.13 + uTime * 0.9) * cos(p.y * 0.104 + uTime * 0.63) * 0.3;
    float hD = sin(p.x * 0.08 + uTime * 0.6) * cos((p.y - eps) * 0.064 + uTime * 0.42) * 0.5
             + sin(p.x * 0.13 + uTime * 0.9) * cos((p.y - eps) * 0.104 + uTime * 0.63) * 0.3;
    float hU = sin(p.x * 0.08 + uTime * 0.6) * cos((p.y + eps) * 0.064 + uTime * 0.42) * 0.5
             + sin(p.x * 0.13 + uTime * 0.9) * cos((p.y + eps) * 0.104 + uTime * 0.63) * 0.3;
    return normalize(vec3(hL - hR, 2.0, hD - hU));
  }

  void main() {
    vec3 N = waveNormal(vWorldPos.xz);

    // View & sun directions
    vec3 V = normalize(uCameraPos - vWorldPos);
    vec3 L = normalize(uSunDir);
    vec3 H = normalize(L + V);

    // Diffuse
    float diff = max(dot(N, L), 0.0) * 0.5 + 0.5;

    // Specular (Blinn-Phong)
    float spec = pow(max(dot(N, H), 0.0), 180.0) * 2.5;

    // Fresnel-ish rim
    float fresnel = pow(1.0 - max(dot(N, V), 0.0), 3.0);

    // Base ocean color – deep blue to teal
    vec3 deepColor    = vec3(0.02, 0.12, 0.28);
    vec3 shallowColor = vec3(0.05, 0.38, 0.45);
    vec3 foamColor    = vec3(0.75, 0.92, 0.98);

    float depth = smoothstep(0.35, 0.75, vWave);
    vec3 baseColor = mix(deepColor, shallowColor, depth);

    // Foam at wave crests
    float foam = smoothstep(0.72, 0.85, vWave);
    baseColor = mix(baseColor, foamColor, foam * 0.4);

    // Sky reflection tint
    vec3 skyColor = vec3(0.40, 0.68, 0.90);
    baseColor = mix(baseColor, skyColor * 0.6, fresnel * 0.45);

    // Specular highlight (sun glint)
    vec3 sunColor = vec3(1.0, 0.9, 0.7);
    baseColor += spec * sunColor;

    // Diffuse shading
    baseColor *= diff;

    gl_FragColor = vec4(baseColor, 0.88);
  }
`;

export function createWater(size = 240) {
  const geometry = new THREE.PlaneGeometry(size, size, 96, 96);
  geometry.rotateX(-Math.PI / 2);

  const uniforms = {
    uTime:       { value: 0 },
    uWaveHeight: { value: 1.2 },
    uSunDir:     { value: new THREE.Vector3(0.6, 0.8, 0.4).normalize() },
    uCameraPos:  { value: new THREE.Vector3() },
  };

  const material = new THREE.ShaderMaterial({
    vertexShader:   WATER_VERT,
    fragmentShader: WATER_FRAG,
    uniforms,
    transparent:    true,
    side:           THREE.FrontSide,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.y = -0.5;
  mesh.renderOrder = 1;
  mesh.name = 'water';

  return mesh;
}

export function updateWater(waterMesh, time, cameraPosition) {
  const u = waterMesh.material.uniforms;
  u.uTime.value      = time;
  u.uCameraPos.value = cameraPosition;
}
