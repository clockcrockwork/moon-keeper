// 月本体。欠けをシェーダで描く。
//
// DirectionalLight は使わない。太陽方向を**ビュー空間**で組み立てれば、
// 真上から見下ろすカメラや、テクスチャの向きを合わせるための
// pivot.rotation.x = PI/2 を一切気にしなくて済む。
// normalMatrix が全ての変換を吸収してくれるので、
// 「画面上で欠けがどう傾いて見えるか」だけを指定すればよい。

export const moonVertex = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vViewNormal;

  void main() {
    vUv = uv;
    vViewNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const moonFragment = /* glsl */ `
  uniform sampler2D uMap;
  uniform vec3 uSunDirView;      // ビュー空間での太陽方向（+z がカメラ側）
  uniform vec3 uMoonColor;
  uniform float uIntensity;
  uniform float uEarthshine;     // 暗部に残る地球照
  uniform vec3 uEarthshineColor;
  uniform float uTerminatorSoft; // 明暗境界のにじみ

  varying vec2 vUv;
  varying vec3 vViewNormal;

  void main() {
    vec3 n = normalize(vViewNormal);
    float ndl = dot(n, uSunDirView);

    // 明暗境界。実際の月の境界は山影でざらつくので少しだけにじませる
    float lit = smoothstep(-uTerminatorSoft, uTerminatorSoft, ndl);

    // Lommel-Seeliger 風のリムダーケニング。縁が落ちて球らしくなる
    float limb = pow(max(ndl, 0.0), 0.35);

    vec3 albedo = texture2D(uMap, vUv).rgb;

    // 地球照。新月でも輪郭が消えないので「常に応答する世界」にも合う
    vec3 dark = uEarthshineColor * uEarthshine;

    vec3 color = albedo * (uMoonColor * uIntensity * lit * limb + dark);
    gl_FragColor = vec4(color, 1.0);
  }
`;

// 月縁のハロー。
// 水中に散乱した広いにじみ（moonGlow）とは別物なので分けてある。
// 月の円盤より内側は抜いて、白飛びさせない。
export const moonHaloVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const moonHaloFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uStrength;
  uniform float uInner;      // 月の円盤の半径（uv 中心からの比）

  varying vec2 vUv;

  void main() {
    float d = length(vUv - 0.5) * 2.0;
    // 円盤の外側だけ光らせる
    float halo = smoothstep(uInner, uInner * 1.12, d) * smoothstep(1.0, uInner * 1.3, d);
    gl_FragColor = vec4(uColor, halo * uStrength);
  }
`;
