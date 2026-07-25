// 端末の性能階層。スマホで滑らかに動くことを最優先にする。
//
// 水面シェーダのコストは描画ピクセル数にほぼ線形なので、いちばん効くレバーは
// pixelRatio。次にシミュレーション解像度（こちらは画面解像度に依存しない）。
//
// 起動時に静的に見積もり、その後は実測フレーム時間で上下させる。
// 往復（ちらつき）を防ぐため、上げる条件と下げる条件は大きく離してある。

export const TIER_ORDER = ['low', 'mid', 'high'];

export const TIERS = {
  low: {
    label: '低',
    simTexels: 26000,        // アスペクト比に合わせて縦横へ配分する総テクセル数
    segments: 48,            // 水面ジオメトリの分割数
    detailOctaves: 0,        // 高周波のさざなみの重ね数（#define なので再コンパイル）
    caustics: false,
    stepHz: 60,
    maxStepsPerFrame: 1,
    pixelRatio: { desktop: 1.5, mobile: 1.25 },
  },
  mid: {
    label: '中',
    simTexels: 65000,
    segments: 72,
    detailOctaves: 2,
    caustics: true,
    stepHz: 60,
    maxStepsPerFrame: 2,
    pixelRatio: { desktop: 2, mobile: 1.75 },
  },
  high: {
    label: '高',
    simTexels: 110000,
    segments: 96,
    detailOctaves: 3,
    caustics: true,
    stepHz: 120,
    maxStepsPerFrame: 2,
    pixelRatio: { desktop: 2, mobile: 1.75 },
  },
};

const SAMPLE_SIZE = 90;
const DOWNGRADE_MS = 20;      // これより遅いフレームが続いたら品質を落とす
const UPGRADE_MS = 12;        // これより速いフレームが十分続いたら上げる
const DOWNGRADE_HOLD = 2000;
const UPGRADE_HOLD = 8000;

// 一つの手掛かりだけだと外すことがあるので（ヘッドレスの Chromium では
// pointer: coarse が立たない、等）、複数の信号を見る。
function isMobileDevice() {
  const uaData = navigator.userAgentData;
  if (uaData && uaData.mobile === true) return true;
  if (window.matchMedia('(pointer: coarse)').matches) return true;
  if (navigator.maxTouchPoints > 1 && window.matchMedia('(hover: none)').matches) return true;
  return /Android|iPhone|iPad|iPod|Mobile|Silk/i.test(navigator.userAgent);
}

function guessTier(renderer, mobile) {
  const cores = navigator.hardwareConcurrency || 4;
  const maxTexture = renderer.capabilities.maxTextureSize;

  // テクスチャサイズが小さい GPU は総じて古い
  if (maxTexture < 4096) return 'low';
  if (mobile) return cores <= 4 ? 'low' : 'mid';
  return cores >= 8 ? 'high' : 'mid';
}

/**
 * 総テクセル数をワールドのアスペクト比に配分する。
 * 正方テクスチャに縦長の領域を載せるとテクセルが非正方になり波が楕円に歪むので、
 * 必ずワールドの縦横比に合わせる。
 */
export function simResolution(texels, worldWidth, worldHeight) {
  const aspect = worldWidth / worldHeight;
  const w = Math.round(Math.sqrt(texels * aspect));
  const h = Math.round(Math.sqrt(texels / aspect));
  return {
    width: Math.min(1024, Math.max(64, w)),
    height: Math.min(1024, Math.max(64, h)),
  };
}

export function createPerf(renderer, { onTierChange } = {}) {
  const mobile = isMobileDevice();
  let forced = null;                          // パネルで手動固定された階層
  let tier = guessTier(renderer, mobile);

  const samples = [];
  let slowSince = 0;
  let fastSince = 0;

  function settings() {
    return TIERS[tier];
  }

  function pixelRatio() {
    const cap = settings().pixelRatio[mobile ? 'mobile' : 'desktop'];
    return Math.min(window.devicePixelRatio || 1, cap);
  }

  function setTier(next, reason) {
    if (next === tier || !TIERS[next]) return;
    tier = next;
    samples.length = 0;
    slowSince = 0;
    fastSince = 0;
    onTierChange?.(settings(), { tier, reason });
  }

  function median(values) {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  }

  return {
    get tier() {
      return tier;
    },
    get isMobile() {
      return mobile;
    },
    settings,
    pixelRatio,

    /** パネルから 'auto' | 'low' | 'mid' | 'high' を渡す。 */
    setQuality(quality) {
      if (quality === 'auto') {
        forced = null;
        setTier(guessTier(renderer, mobile), 'auto');
      } else if (TIERS[quality]) {
        forced = quality;
        setTier(quality, 'manual');
      }
    },

    /** 毎フレーム呼ぶ。フレーム時間から階層を上下させる。 */
    sample(frameMs, now) {
      if (forced) return;
      // 復帰直後などの外れ値は捨てる
      if (frameMs > 200) return;

      samples.push(frameMs);
      if (samples.length < SAMPLE_SIZE) return;
      if (samples.length > SAMPLE_SIZE) samples.shift();

      const med = median(samples);

      if (med > DOWNGRADE_MS) {
        fastSince = 0;
        if (!slowSince) slowSince = now;
        else if (now - slowSince > DOWNGRADE_HOLD) {
          const idx = TIER_ORDER.indexOf(tier);
          if (idx > 0) setTier(TIER_ORDER[idx - 1], 'slow');
          else slowSince = now;
        }
      } else if (med < UPGRADE_MS) {
        slowSince = 0;
        if (!fastSince) fastSince = now;
        else if (now - fastSince > UPGRADE_HOLD) {
          const idx = TIER_ORDER.indexOf(tier);
          if (idx < TIER_ORDER.length - 1) setTier(TIER_ORDER[idx + 1], 'fast');
          else fastSince = now;
        }
      } else {
        slowSince = 0;
        fastSince = 0;
      }
    },
  };
}
