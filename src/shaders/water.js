import { swellBaseChunk, swellDetailChunk } from './swell.js';

// 水面。高さと勾配はシミュレーションのテクスチャ1枚から取り、
// その上に解析的なうねり（swell）を重ねる。
//
// 受光は2層に分けて扱う（moon_phase_design.md の原則）:
//   Moon-driven        … 月相に従属してよい光。透過の輝きとコースティクス
//   Interaction-driven … 月相に従属させない光。屈折の歪みと波頭
// 新月で月が見えない夜でも、触れば水面は必ず応える。
//
// 高さの単位に注意:
//   vSimHeight … シミュレーションの生の値（±1）。元コードの感度をそのまま使えるよう、
//                波頭と谷の判定はこちらで行う
//   vSwell     … うねりの高さ（ワールド単位）。触った波紋と混ぜずに別で扱う
//
// 性能: フラグメントのテクスチャフェッチは通常2回（シミュレーション + 屈折）だけ。
// 法線用の近傍4フェッチはシミュレーション側で勾配を書き出すことで消してある。
// 低周波のうねりも頂点シェーダで解いて varying で運ぶので、ピクセルごとの
// sin/cos は高階層のさざなみぶんだけになる。

export const waterVertex = /* glsl */ `
  uniform sampler2D uSim;
  uniform float uHeightScale;
  uniform float uSwell;
  uniform float uTime;

  varying vec2 vUv;
  varying vec3 vWorldPos;
  varying vec2 vScreenUV;
  varying float vSimHeight;
  varying float vSwell;
  varying vec2 vSwellGrad;

  ${swellBaseChunk}

  void main() {
    vUv = uv;

    float simRaw = texture2D(uSim, uv).r;
    vec3 swell = swellBase(position.xz, uTime);

    vSimHeight = simRaw;
    vSwell = swell.x * uSwell;
    vSwellGrad = swell.yz * uSwell;

    vec3 pos = position;
    pos.y += simRaw * uHeightScale + vSwell;

    vWorldPos = (modelMatrix * vec4(pos, 1.0)).xyz;
    vec4 clip = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
    vScreenUV = clip.xy / clip.w * 0.5 + 0.5;
    gl_Position = clip;
  }
`;

export const waterFragment = /* glsl */ `
  uniform sampler2D uSim;
  uniform sampler2D uUnderwater;
  uniform vec2 uSimTexel;
  uniform float uHeightScale;
  uniform float uSwell;
  uniform float uTime;

  uniform vec3 uCameraPos;
  uniform vec3 uMoonPos;
  uniform vec3 uMoonColor;
  uniform vec3 uCrestColor;
  uniform vec3 uSkyColor;

  uniform vec2 uHalfWorld;
  uniform float uRefract;
  uniform float uFresnel;
  uniform float uSpecular;
  uniform float uCaustics;
  uniform float uEnergy;
  uniform float uWindowLight;

  varying vec2 vUv;
  varying vec3 vWorldPos;
  varying vec2 vScreenUV;
  varying float vSimHeight;
  varying float vSwell;
  varying vec2 vSwellGrad;

  ${swellDetailChunk}

  void main() {
    vec4 sim = texture2D(uSim, vUv);

    // 勾配はシミュレーション側で書き出してあるので、法線のための近傍フェッチは不要
    vec2 grad = sim.zw * uHeightScale + vSwellGrad
              + swellDetail(vWorldPos.xz, uTime) * uSwell;

    vec3 N = normalize(vec3(-grad.x, 1.0, -grad.y));
    vec3 V = normalize(uCameraPos - vWorldPos);

    // --- 屈折（Interaction-driven。月相で弱めない） ---
    vec3 underwater = texture2D(uUnderwater, clamp(vScreenUV + N.xz * uRefract, 0.001, 0.999)).rgb;

    // --- フレネル ---
    // 真上から見ているので普段はほとんど効かないが、波の斜面が立つとそこだけ
    // 反射側に振れる。夜なので反射して返るのは空の暗さで、斜面が暗く沈む。
    float fresnel = mix(0.02, 1.0, pow(1.0 - max(dot(N, V), 0.0), 5.0)) * uFresnel;
    vec3 color = mix(underwater, uSkyColor, fresnel);

    // --- 月明かりの透過（Moon-driven） ---
    // 注意: ここは意図的に V - L。月は水面の「下」にあるため L はほぼ -Y、
    // V はほぼ +Y で、教科書どおりの normalize(V + L) はゼロベクトルの正規化になり
    // 破綻する。水面が平らなほど月の光がまっすぐ目に届く = 明るい、という
    // 透過の関係なので、これで正しい向きになる。
    vec3 L = normalize(uMoonPos - vWorldPos);
    float through = pow(max(dot(N, normalize(V - L)), 0.0), 64.0);
    color += uMoonColor * through * uSpecular;

    // --- 波頭（Interaction-driven。常に見える） ---
    color += uCrestColor * smoothstep(0.01, 0.06, vSimHeight) * 0.45;

    // 触った直後だけ乗る補助光。新月でも「触った」ことが必ず返る
    color += uCrestColor * uEnergy * smoothstep(0.02, 0.10, abs(vSimHeight)) * 0.20;

    // --- うねりの微かな煌めき（触った波紋を埋もれさせないよう控えめに） ---
    color += uCrestColor * smoothstep(0.004, 0.016, vSwell) * 0.05;

  #ifdef CAUSTICS
    // 波の凹みが光を集める。書き出しておいた勾配の発散（前進差分）を使うので、
    // 近傍の高さを4回引くより半分の2フェッチで済む。
    vec2 gx = texture2D(uSim, vUv + vec2(uSimTexel.x, 0.0)).zw;
    vec2 gz = texture2D(uSim, vUv + vec2(0.0, uSimTexel.y)).zw;
    float divergence = (gx.x - sim.z) + (gz.y - sim.w);
    color += uMoonColor * max(divergence, 0.0) * uCaustics;
  #endif

    // --- 波の谷は少し暗く ---
    color *= 1.0 - smoothstep(0.0, -0.08, vSimHeight) * 0.15;

    // --- 窓辺の光 ---
    // 「真夜中に水槽持ち出して窓辺においた」の示唆。
    // 窓枠のような形あるものは描かず、斜めに差し込む光だけを置く。
    float win = 1.0 - (vScreenUV.x * 0.62 + (1.0 - vScreenUV.y) * 0.38);
    color += uMoonColor * pow(max(win, 0.0), 2.4) * uWindowLight * 0.085;

    // --- 画面の縁の水際 ---
    // 器は描かないが、水が画面の縁で終わっていることは示す。
    // 中心からの距離ではなく各辺からの距離で効かせる（縦長画面で不自然にならない）。
    vec2 toEdge = uHalfWorld - abs(vWorldPos.xz);
    float edge = min(toEdge.x, toEdge.y);
    color *= 1.0 - smoothstep(0.34, 0.0, edge) * 0.32;
    color += uCrestColor * smoothstep(0.16, 0.34, edge) * smoothstep(0.78, 0.40, edge) * 0.05;

    gl_FragColor = vec4(color, 1.0);
  }
`;
