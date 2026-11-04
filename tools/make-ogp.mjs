// SNS 共有用の OGP 画像（1200×630）を、実際の WebGL 描画から撮る。
//
// 依存は shot.mjs と同じくグローバルの playwright だけ。
//
//   npx http-server -p 8080 -c-1 .        # 別ターミナルで
//   NODE_PATH=$(npm root -g) node tools/make-ogp.mjs
//
// オプション:
//   --url=http://localhost:8080     ベース URL
//   --out=ogp.jpg                   出力先（.jpg / .png）
//   --quality=88                    JPEG 品質
//
// 再現性のために固定しているもの:
//   - 時刻（月相・月の傾き）   FIXED_TIME
//   - タイムゾーン（観測地の推定）Asia/Tokyo。現在地 API は使わない（許可も与えない）
//   - 乱数（星の配置・月の自転・自然な波紋の位置）  シード付き Math.random
//   - 画面サイズ 1200×630 / DPR 1、描画品質 high
//   - 保存設定・共有 URL は読まない（新しいブラウザコンテキスト、ハッシュなし）
//
// 撮影者の現在地・個人設定・共有 URL の内容は画像に入らない。
// 波紋はフレーム時間に依存するので、完全なピクセル一致までは保証しない。

import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const HERE = path.dirname(fileURLToPath(import.meta.url));

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v = 'true'] = a.replace(/^--/, '').split('=');
    return [k, v];
  })
);

const BASE = args.url ?? 'http://localhost:8080';
const OUT = args.out ?? path.join(HERE, '..', 'ogp.jpg');
const QUALITY = Number(args.quality ?? 88);

const WIDTH = 1200;
const HEIGHT = 630;

// 満月の少し前（十三夜ごろ）。丸すぎず、欠けが分かり、月明かりも十分にある。
const FIXED_TIME = '2026-10-23T21:30:00+09:00';
const SEED = 20261104;

// 置く波紋（画面比）と、撮るまでの待ち時間 ms
const RIPPLES = [
  [0.27, 0.64],
  [0.76, 0.3],
];
const RIPPLE_GAP = Number(args.gap ?? 500);
const RIPPLE_SETTLE = Number(args.settle ?? 2200);

// 撮影時だけの設定。既定値からの差分として localStorage に入れる。
// 時計（日付と月齢の文字）は撮影日が写り込むので消す。品質は自動調整で揺れないよう固定。
const SCENE = {
  clock: { show: false },
  scene: { quality: 'high' },
};

let vendoredThree = null;
try {
  vendoredThree = await readFile(path.join(HERE, 'vendor/three.module.js'), 'utf8');
} catch {
  // CDN に出られる環境ならそのまま jsdelivr から読む
}

const browser = await chromium.launch({
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle'],
});
const context = await browser.newContext({
  viewport: { width: WIDTH, height: HEIGHT },
  deviceScaleFactor: 1,
  timezoneId: 'Asia/Tokyo',
  locale: 'ja-JP',
  permissions: [],
});
const page = await context.newPage();

const problems = [];
page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
page.on('console', (msg) => {
  if (msg.type() !== 'error') return;
  const text = msg.text();
  if (text.includes('GPU stall due to ReadPixels')) return;
  problems.push(`console.error: ${text}`);
});

if (vendoredThree) {
  await page.route('**/three@*/build/three.module.js', (route) =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: vendoredThree })
  );
}

await page.clock.setFixedTime(new Date(FIXED_TIME));
await page.addInitScript(
  ({ seed, scene }) => {
    // mulberry32
    let a = seed >>> 0;
    Math.random = () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    try {
      localStorage.clear();
      localStorage.setItem('moon-keeper.v1', JSON.stringify(scene));
    } catch {
      // 保存できなくても既定値で撮れる
    }
  },
  { seed: SEED, scene: SCENE }
);

await page.goto(`${BASE}/`, { waitUntil: 'load' });

// 操作のための UI（案内・クレジット・設定タブ）は画像に要らない。
// 作品名だけを、サイトと同じ控えめな明朝で下に置く。
// 明朝体が入っていない環境のために、撮影時だけ Noto Serif JP（OFL）を3文字分読む。
await page.addStyleTag({
  url: 'https://fonts.googleapis.com/css2?family=Noto+Serif+JP:wght@400&text=%E6%9C%88%E9%A3%BC%E3%81%84&display=block',
}).catch(() => problems.push('注意: Noto Serif JP を読めなかった。ローカルの serif で撮る'));
await page.addStyleTag({
  content: `
    #hint, #credits, #credits-area, #panel { display: none !important; }
    #title {
      opacity: 1 !important;
      transition: none !important;
      bottom: 34px !important;
      font-family: "Noto Serif JP", "Yu Mincho", "Hiragino Mincho ProN", serif !important;
      font-size: 22px !important;
      letter-spacing: 0.6em !important;
      padding-left: 0.6em;  /* letter-spacing の右余りを打ち消して中央に置く */
      color: rgba(255, 255, 255, 0.62) !important;
      text-shadow: 0 0 12px rgba(0, 0, 0, 0.6);
    }
  `,
});
await page.evaluate(() => document.fonts.ready);

// 起動直後のフェードと、月テクスチャの読み込みを待つ
await page.waitForTimeout(5000);

// 水面であることが縮小表示でも分かるよう、月を避けた位置に波紋を置く。
// 位置は画面比で固定。輪の広がり具合は描画速度に左右される。
for (const [x, y] of RIPPLES) {
  await page.mouse.click(WIDTH * x, HEIGHT * y);
  await page.waitForTimeout(RIPPLE_GAP);
}
await page.waitForTimeout(RIPPLE_SETTLE);

const ok = await page.evaluate(() => {
  const c = document.querySelector('canvas');
  return !!c && c.width > 0;
});
if (!ok) problems.push('canvas が無い');

const type = OUT.endsWith('.png') ? 'png' : 'jpeg';
await page.screenshot({
  path: OUT,
  type,
  ...(type === 'jpeg' ? { quality: QUALITY } : {}),
  clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT },
});

await browser.close();

console.log(`撮影 ${OUT} (${WIDTH}x${HEIGHT}, ${FIXED_TIME})`);
if (problems.length) {
  console.error('\n問題:');
  for (const p of problems) console.error('  - ' + p);
  process.exit(1);
}
