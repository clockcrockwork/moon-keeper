// 全パラメータの単一の置き場。
// Phase 3 でここに localStorage 永続化・URL ハッシュ共有・操作パネルが乗る。
// 各モジュールは onStateChange() で購読し、applyState() で一斉に反映される。

export const state = {
  moon: {
    // 月明かり。月本体・グロー・水面スペキュラ・波頭に伝播する。
    // 元コードはシェーダに vec3(0.9, 0.85, 0.7) を直書きしていた。ここは hex で持ち、
    // THREE.Color が sRGB → リニアに変換する（色管理として正しく、
    // <input type="color"> とも素直に繋がる）。
    // そのぶん元の直書き値よりわずかに深い暖色になる。
    color: '#e6d9b3',
    intensity: 1.0,
    size: 0.165,          // 月の直径が画面の短辺に占める割合（絶対サイズではない）
    depth: 5.0,
    glow: 0.09,           // 水中に散乱した月明かりの広いにじみ
    halo: 0.07,           // 月縁に張り付くハロー
    spin: 0.006,          // rad/秒。1周およそ17分
    earthshine: 0.05,     // 暗部に残る地球照。新月でも輪郭が消えない
    terminatorSoft: 0.07, // 明暗境界のにじみ
    driftAmount: 0.14,    // 漂いの振幅（月の半径に対する比）
    phaseMode: 'auto',    // 'auto' = 現在時刻から / 'manual' = スライダー
    phaseManual: 0.5,
  },
  location: {
    mode: 'timezone',     // 'timezone' | 'geolocation' | 'manual'
    lat: null,            // null ならタイムゾーンから推定する
    lon: null,
  },
  stars: {
    count: 250,
    brightness: 1.0,
    twinkle: 1.0,
  },
  water: {
    damping: 0.97,          // 大きいほど波が長く残る
    speed: 0.45,            // 波の伝わる速さ
    rippleStrength: 0.6,    // 触った時の強さ
    swell: 1.0,             // 常時のうねり。触っていない所の「水面感」
    refract: 0.06,          // 水中像の歪みの強さ（月相に依存させない）
    fresnel: 1.0,           // 波の斜面が空の暗さを返す強さ
    specular: 0.07,         // 平らな面が月を透かす明るさ（月相に連動してよい）
    caustics: 1.2,          // 波の凹みが光を集める強さ
    ambientStrength: 0.22,  // 自然に立つ波紋
    ambientInterval: 2600,  // ms
  },
  sky: {
    color: '#010306',
  },
};

const listeners = new Set();

/** state の変更を購読する。戻り値を呼ぶと解除。 */
export function onStateChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** state を触ったあとに呼ぶ。購読者全員に伝える。 */
export function applyState() {
  for (const fn of listeners) fn(state);
}
