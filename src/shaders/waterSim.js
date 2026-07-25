// 波の高さ場を GPU で解く更新パス。ping-pong する2枚のレンダーターゲットの間で走る。
//
// チャンネル: r = 高さ, g = 速度, zw(ba) = ワールド単位の勾配
//
// 勾配をここで書き出しておくのが効きどころ。近傍4テクセルはこのパスで既に
// 引いているので勾配はタダで、そのぶん水面シェーダは1回のフェッチで
// 高さと法線の両方を得られる（全画面ぶんの4フェッチが消える）。

export const simVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

export const simFragment = /* glsl */ `
  precision highp float;

  uniform sampler2D uPrev;
  uniform vec2 uTexel;         // 1 / 解像度
  uniform vec2 uTexelWorld;    // テクセル1つ分のワールド距離
  uniform vec2 uWorldSize;     // 水面のワールド寸法
  uniform float uDamping;
  uniform float uWaveSpeed;
  uniform vec4 uSplats[SPLAT_SLOTS];   // xy = uv, z = 半径(ワールド), w = 強さ

  varying vec2 vUv;

  void main() {
    // clamp で端の外を端自身にする = Neumann 境界。波は壁で跳ね返る。
    // 水面を画面ぴったりにしてあるので、この「壁」は画面の四辺になる。
    vec2 lo = uTexel * 0.5;
    vec2 hi = 1.0 - uTexel * 0.5;

    vec4 self = texture2D(uPrev, vUv);
    float h = self.r;
    float v = self.g;

    float hl = texture2D(uPrev, clamp(vUv - vec2(uTexel.x, 0.0), lo, hi)).r;
    float hr = texture2D(uPrev, clamp(vUv + vec2(uTexel.x, 0.0), lo, hi)).r;
    float hd = texture2D(uPrev, clamp(vUv - vec2(0.0, uTexel.y), lo, hi)).r;
    float hu = texture2D(uPrev, clamp(vUv + vec2(0.0, uTexel.y), lo, hi)).r;

    v += ((hl + hr + hd + hu) * 0.25 - h) * uWaveSpeed;
    v *= uDamping;

    // 触点のインパルス。高さを代入するのではなく速度へ加算するので、
    // ドラッグを続けると波が積み上がって自然になる。
    //
    // 形はメキシカンハット（ガウシアンのラプラシアン）。中心が凹み、その周りに
    // 逆符号の縁が立つので、1タップで**複数の輪**が広がる。
    // なめらかな円錐だと太い瘤が1つ出るだけで、「波紋」ではなく
    // 「光の円が広がっている」ようにしか見えなかった。
    for (int i = 0; i < SPLAT_SLOTS; i++) {
      vec4 s = uSplats[i];
      float d = length((vUv - s.xy) * uWorldSize);
      float sigma = max(s.z, 1e-4);
      float q = (d * d) / (2.0 * sigma * sigma);
      v -= s.w * (1.0 - q) * exp(-q);
    }

    h = clamp(h + v, -1.0, 1.0);

    float dhdx = (hr - hl) * 0.5 / uTexelWorld.x;
    float dhdz = (hu - hd) * 0.5 / uTexelWorld.y;

    gl_FragColor = vec4(h, v, dhdx, dhdz);
  }
`;
