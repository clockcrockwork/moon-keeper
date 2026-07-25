// 常時のうねり。「触っているところ以外も水面感を出したい」の土台。
//
// シミュレーションに混ぜると数値が溜まって暴れるので、うねりは
// 解析的な進行波として水面シェーダ側で足す。テクスチャを引かず sin/cos だけで、
// しかも高さと勾配を同時に出せる（法線がタダで手に入る）。
//
// 性能のため2段に分けている:
//   swellBase   … 低周波の3本。波長が 3〜7 ワールド単位あり、頂点間隔より十分長いので
//                 頂点シェーダで解いて varying で運べる。ピクセルごとの sin が消える。
//   swellDetail … 高周波のさざなみ。頂点間隔では補間できないのでフラグメントで解くが、
//                 DETAIL_OCTAVES で本数を絞る（低階層では 0 本 = 完全にゼロコスト）。

const addWave = /* glsl */ `
  // 1本の進行波の高さと勾配を足し込む。
  // acc.x = 高さ, acc.yz = ワールド xz 方向の勾配
  void addWave(inout vec3 acc, vec2 p, float t, vec2 dir, float freq, float speed, float amp) {
    float phase = dot(p, dir) * freq + t * speed;
    acc.x += sin(phase) * amp;
    acc.yz += dir * (freq * amp * cos(phase));
  }
`;

// 方向・周期・速さを互いに非整数比にして、反復パターンが読めないようにする。
//
// 振幅はワールド単位。触った波紋が最大 0.3 ほどなので、うねりはその 1/15 程度に留める。
// ここを大きくすると水面全体が常時ぎらついて、触った時の応答が埋もれてしまう。
export const swellBaseChunk = /* glsl */ `
  ${addWave}

  vec3 swellBase(vec2 p, float t) {
    vec3 acc = vec3(0.0);
    addWave(acc, p, t, vec2( 0.862,  0.507), 0.90,  0.55, 0.01100);
    addWave(acc, p, t, vec2(-0.407,  0.913), 1.37, -0.41, 0.00640);
    addWave(acc, p, t, vec2( 0.291, -0.957), 2.11,  0.77, 0.00320);
    return acc;
  }
`;

// フラグメント側。勾配だけ返す（高さの寄与は無視できるほど小さい）。
export const swellDetailChunk = /* glsl */ `
  vec2 swellDetail(vec2 p, float t) {
  #if DETAIL_OCTAVES == 0
    return vec2(0.0);
  #else
    vec2 g = vec2(0.0);
    vec2 d0 = vec2( 0.707,  0.707);
    float p0 = dot(p, d0) *  4.30 + t *  1.13;
    g += d0 * ( 4.30 * 0.00110 * cos(p0));
  #if DETAIL_OCTAVES >= 2
    vec2 d1 = vec2(-0.940,  0.342);
    float p1 = dot(p, d1) *  7.90 - t *  1.61;
    g += d1 * ( 7.90 * 0.00044 * cos(p1));
  #endif
  #if DETAIL_OCTAVES >= 3
    vec2 d2 = vec2( 0.139,  0.990);
    float p2 = dot(p, d2) * 11.30 + t *  2.07;
    g += d2 * (11.30 * 0.00022 * cos(p2));
  #endif
    return g;
  #endif
  }
`;
