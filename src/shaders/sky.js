// 天の川と流れ星。どちらも水中シーンに置くので、水面の屈折で一緒に歪む。

export const milkyWayVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// 帯状のもやを重ねたノイズで作る。テクスチャを持たず板1枚で済ませる。
export const milkyWayFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uStrength;
  uniform float uTime;
  varying vec2 vUv;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
      mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
      f.y
    );
  }

  void main() {
    vec2 p = vUv * 2.0 - 1.0;

    // 斜めに走る帯
    float band = p.y * 0.72 + p.x * 0.42;
    float core = exp(-band * band * 7.0);

    // もやのむら
    float n = noise(vUv * 6.0 + vec2(uTime * 0.004, 0.0)) * 0.6
            + noise(vUv * 14.0) * 0.3
            + noise(vUv * 30.0) * 0.1;

    // 画面の縁で自然に消える
    float vignette = smoothstep(1.35, 0.25, length(p));

    float a = core * n * vignette * uStrength;
    gl_FragColor = vec4(uColor, a);
  }
`;

export const shootingStarVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// 頭が明るく尾が細く消える光条。uProgress で流れて、端で自然に消える。
export const shootingStarFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying vec2 vUv;

  void main() {
    // uv.x = 尾(0) → 頭(1)
    float along = vUv.x;
    float across = abs(vUv.y - 0.5) * 2.0;

    float taper = pow(along, 3.0);                 // 頭に向かって太く明るく
    float core = smoothstep(1.0, 0.0, across / max(taper, 0.04));
    float head = smoothstep(0.86, 1.0, along) * 1.6;

    float a = (core * taper + head * core) * uOpacity;
    gl_FragColor = vec4(uColor, a);
  }
`;
