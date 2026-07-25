// 全パラメータの単一の置き場。
// Phase 3 でここに localStorage 永続化・URL ハッシュ共有・操作パネルが乗る。
// 各モジュールは onStateChange() で購読し、applyState() で一斉に反映される。

export const state = {
  moon: {
    // 月明かり。月本体・グロー・水面スペキュラ・波頭に伝播する。
    // 元コードはシェーダに vec3(0.9, 0.85, 0.7) を直書きしていた。ここは hex で持ち、
    // THREE.Color が sRGB → リニアに変換する（色管理として正しく、
    // Phase 3 の <input type="color"> とも素直に繋がる）。
    // そのぶん元の直書き値よりわずかに深い暖色になる。
    color: '#e6d9b3',
    intensity: 1.0,
    size: 2.0,
    depth: 5.0,
    glow: 0.15,
    spin: 0.006,        // rad/秒。1周およそ17分
  },
  stars: {
    count: 250,
    brightness: 1.0,
    twinkle: 1.0,
  },
  water: {
    damping: 0.97,
    speed: 0.45,
    rippleStrength: 0.6,
    ambientStrength: 0.25,
    ambientInterval: 2500,   // ms
    segments: 150,
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
