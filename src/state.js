// 全パラメータの単一の置き場。
//
// 各モジュールは onStateChange() で購読し、applyState() で一斉に反映される。
// 変更は localStorage に保存し、URL ハッシュで人に渡せる。

const STORAGE_KEY = 'moon-keeper.v1';

export const defaults = {
  moon: {
    // 月明かり。月本体・グロー・ハロー・水面の透過・波頭に伝播する。
    // 元コードはシェーダに vec3(0.9, 0.85, 0.7) を直書きしていた。ここは hex で持ち、
    // THREE.Color が sRGB → リニアに変換する（色管理として正しく、
    // <input type="color"> とも素直に繋がる）。
    color: '#e6d9b3',
    intensity: 1.0,
    size: 0.165,          // 月の直径が画面の短辺に占める割合（絶対サイズではない）
    depth: 5.0,
    glow: 0.09,           // 水中に散乱した月明かりの広いにじみ
    halo: 0.07,           // 月縁に張り付くハロー
    spin: 0.006,          // rad/秒。1周およそ17分
    earthshine: 0.05,     // 暗部に残る地球照。新月でも輪郭が消えない
    terminatorSoft: 0.07, // 明暗境界のにじみ
    // 月は「空の月が水面に映っているもの」で、自分から動き回る物ではない。
    // 漂いと傾きは水面が揺れているぶんだけに抑え、位置は下の offset で決める。
    driftAmount: 0.05,    // 漂いの振幅（月の半径に対する比）
    tiltAmount: 0.07,     // 払った時に傾く上限（rad）
    offsetX: 0,           // 位置。可視範囲の半分に対する比（-1〜1）
    offsetZ: 0,
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
    color: '#bfccff',
    shootingStars: true,
    milkyWay: 0.3,
  },
  water: {
    damping: 0.97,          // 大きいほど波が長く残る
    speed: 0.45,            // 波の伝わる速さ
    rippleStrength: 0.6,    // 触った時の強さ
    rippleRadius: 0.16,     // 波紋の芯の太さ（ワールド単位）。細いほど輪が細くなる
    swell: 1.0,             // 常時のうねり。触っていない所の「水面感」
    refract: 0.032,         // 水中像の歪みの強さ（月相に依存させない）
    fresnel: 1.0,           // 波の斜面が空の暗さを返す強さ
    specular: 0.07,         // 平らな面が月を透かす明るさ（月相に連動してよい）
    caustics: 1.2,          // 波の凹みが光を集める強さ
    ripple: 1.0,            // 波の輪の光り方（勾配由来なので細い輪になる）
    crestColor: '#b3bfe6',  // 波頭とメニスカスの色
    // 光の合成方式。0 = 加算（元の見え方）、1 = スクリーン。
    // 加算は明るい所で 1.0 を超えて白飛びし、隣の輪とつながって
    // 「光の円がただ広がっている」ように見えてしまう。
    // スクリーンは 1.0 に漸近するので輪の構造が残る。
    lightBlend: 1.0,
    ambientStrength: 0.22,  // 自然に立つ波紋
    ambientInterval: 2600,  // ms
  },
  clock: {
    show: true,
    seconds: false,
    moonName: true,         // 月相の和名を併記する
    depth: 2.5,             // 水面と月の間
    opacity: 0.5,
  },
  scene: {
    quality: 'auto',        // 'auto' | 'low' | 'mid' | 'high'
    windowLight: 0.35,      // 「窓辺においた」の示唆。光だけで器は描かない
    // 最終段のカラーフィルター（オーバーレイ合成）。
    // オーバーレイは下地が暗いと暗い方へ振れるので、光を足す用途には使えない。
    // ここは月や波頭という明るい下地があるので、本来の「色を深める」働きをする。
    colorFilter: 0.0,
    filterColor: '#6a86c8',
  },
  sky: {
    color: '#010306',
  },
};

// 1タップで世界が変わるプリセット。
export const PRESETS = [
  {
    id: 'midnight',
    label: '真夜中',
    patch: {
      moon: { color: '#e6d9b3', intensity: 1.0, glow: 0.09, halo: 0.07 },
      stars: { brightness: 1.0, count: 250, color: '#bfccff', milkyWay: 0.3 },
      water: { swell: 1.0, damping: 0.97, refract: 0.032, rippleStrength: 0.6, crestColor: '#b3bfe6' },
      sky: { color: '#010306' },
      scene: { windowLight: 0.35 },
    },
  },
  {
    id: 'amber',
    label: '琥珀の月',
    patch: {
      moon: { color: '#ffb861', intensity: 1.15, glow: 0.14, halo: 0.11 },
      stars: { brightness: 0.55, count: 160, color: '#ffd9a8', milkyWay: 0.15 },
      water: { swell: 0.8, damping: 0.975, refract: 0.030, rippleStrength: 0.6, crestColor: '#ffcf9c' },
      sky: { color: '#0a0603' },
      scene: { windowLight: 0.5 },
    },
  },
  {
    id: 'azure',
    label: '蒼い月',
    patch: {
      moon: { color: '#9fc4ff', intensity: 1.05, glow: 0.1, halo: 0.09 },
      stars: { brightness: 1.3, count: 380, color: '#d6e4ff', milkyWay: 0.5 },
      water: { swell: 1.1, damping: 0.972, refract: 0.038, rippleStrength: 0.6, crestColor: '#aaccff' },
      sky: { color: '#01040c' },
      scene: { windowLight: 0.25 },
    },
  },
  {
    id: 'blood',
    label: '血の月',
    patch: {
      moon: { color: '#d4573c', intensity: 1.2, glow: 0.16, halo: 0.13 },
      stars: { brightness: 0.4, count: 120, color: '#ffb3a0', milkyWay: 0.1 },
      water: { swell: 0.9, damping: 0.978, refract: 0.035, rippleStrength: 0.6, crestColor: '#e08a6e' },
      sky: { color: '#0b0202' },
      scene: { windowLight: 0.2 },
    },
  },
  {
    id: 'dawn',
    label: '窓辺の朝',
    patch: {
      moon: { color: '#fff0d9', intensity: 0.8, glow: 0.06, halo: 0.05 },
      stars: { brightness: 0.15, count: 60, color: '#ffffff', milkyWay: 0.0 },
      water: { swell: 0.6, damping: 0.98, refract: 0.025, rippleStrength: 0.6, crestColor: '#ffe8cc' },
      sky: { color: '#0d1016' },
      scene: { windowLight: 1.0 },
    },
  },
  {
    id: 'storm',
    label: '嵐',
    patch: {
      moon: { color: '#cfd6e6', intensity: 0.9, glow: 0.07, halo: 0.05 },
      stars: { brightness: 0.3, count: 90, color: '#c8d4ff', milkyWay: 0.05 },
      water: { swell: 3.2, damping: 0.985, refract: 0.055, rippleStrength: 1.0, crestColor: '#d8e2ff' },
      sky: { color: '#04060a' },
      scene: { windowLight: 0.15 },
    },
  },
];

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function deepClone(source) {
  const out = {};
  for (const [k, v] of Object.entries(source)) {
    out[k] = isPlainObject(v) ? deepClone(v) : v;
  }
  return out;
}

/** patch を target へ再帰的に流し込む。既定に無いキーは無視する。 */
function merge(target, patch) {
  if (!isPlainObject(patch)) return;
  for (const [k, v] of Object.entries(patch)) {
    if (!(k in target)) continue;
    if (isPlainObject(target[k]) && isPlainObject(v)) merge(target[k], v);
    else if (!isPlainObject(target[k]) && !isPlainObject(v)) target[k] = v;
  }
}

export const state = deepClone(defaults);

/** 'moon.color' のようなパスで読む。 */
export function getPath(path) {
  return path.split('.').reduce((o, k) => (o == null ? o : o[k]), state);
}

/** 'moon.color' のようなパスで書く。 */
export function setPath(path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  const parent = keys.reduce((o, k) => o[k], state);
  parent[last] = value;
}

// ---- 購読 ----
const listeners = new Set();

/** state の変更を購読する。戻り値を呼ぶと解除。 */
export function onStateChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** state を触ったあとに呼ぶ。購読者全員に伝えて保存する。 */
export function applyState({ persist = true } = {}) {
  for (const fn of listeners) fn(state);
  if (persist) scheduleSave();
}

export function applyPreset(id) {
  const preset = PRESETS.find((p) => p.id === id);
  if (!preset) return;
  merge(state, preset.patch);
  applyState();
}

/** 既定値へ戻す。 */
export function resetState() {
  merge(state, defaults);
  applyState();
}

// ---- 保存と共有 ----

/** 既定と違う値だけを集める（保存とURLを短く保つ）。 */
function diffFromDefaults(current = state, base = defaults) {
  const out = {};
  for (const [k, v] of Object.entries(current)) {
    if (isPlainObject(v)) {
      const nested = diffFromDefaults(v, base[k]);
      if (Object.keys(nested).length) out[k] = nested;
    } else if (v !== base[k]) {
      out[k] = v;
    }
  }
  return out;
}

let saveTimer = 0;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      const diff = diffFromDefaults();
      if (Object.keys(diff).length) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(diff));
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }
    } catch {
      // プライベートブラウズなどで保存できないことがある。動作は止めない
    }
  }, 400);
}

function toBase64Url(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text) {
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** 今の設定を共有できる URL にする。 */
export function shareUrl() {
  const diff = diffFromDefaults();
  const base = location.origin + location.pathname;
  if (!Object.keys(diff).length) return base;
  return `${base}#s=${toBase64Url(JSON.stringify(diff))}`;
}

/**
 * 起動時の読み込み。URL ハッシュが localStorage より優先される
 * （人からもらったリンクを開いたら、その設定で見えるべき）。
 */
export function loadState() {
  let source = 'default';

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      merge(state, JSON.parse(stored));
      source = 'stored';
    }
  } catch {
    // 壊れた保存データは黙って無視する
  }

  const match = /(?:^|[#&])s=([A-Za-z0-9\-_]+)/.exec(location.hash);
  if (match) {
    try {
      merge(state, JSON.parse(fromBase64Url(match[1])));
      source = 'url';
    } catch {
      // 壊れたハッシュも無視する
    }
  }

  return source;
}
