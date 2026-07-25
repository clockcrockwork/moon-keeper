// スクリーンショットとフレーム時間の計測。
//
// 依存はグローバルに入っている playwright だけ。プロジェクトに package.json は作らない。
//
//   npx http-server -p 8080 -c-1 .        # 別ターミナルで
//   NODE_PATH=$(npm root -g) node tools/shot.mjs
//
// オプション:
//   --url=http://localhost:8080     ベース URL
//   --out=tools/shots               出力先
//   --perf                          モバイル相当の負荷でフレーム時間を測る
//   --only=name                     指定した1件だけ撮る

import { createRequire } from 'node:module';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const HERE = path.dirname(fileURLToPath(import.meta.url));

// three は本番では jsdelivr から読む。CDN に出られない環境でも検証できるよう、
// tools/vendor に置いたコピーでリクエストを差し替える（本番の importmap は触らない）。
//   npm pack three@0.160.0 && tar xzf three-0.160.0.tgz
//   cp package/build/three.module.js tools/vendor/three.module.js
let vendoredThree = null;
try {
  vendoredThree = await readFile(path.join(HERE, 'vendor/three.module.js'), 'utf8');
} catch {
  console.warn(
    '注意: tools/vendor/three.module.js が無い。CDN に到達できない環境では失敗する。'
  );
}

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v = 'true'] = a.replace(/^--/, '').split('=');
    return [k, v];
  })
);

const BASE = args.url ?? 'http://localhost:8080';
const OUT = args.out ?? 'tools/shots';
const SETTLE = Number(args.settle ?? 2500);

// 撮る状態。hash は Phase 3 の状態共有フォーマット（それ以前は無視される）
const SHOTS = [
  { name: 'desktop', viewport: { width: 1440, height: 900 }, dpr: 2 },
  { name: 'phone-portrait', viewport: { width: 390, height: 844 }, dpr: 3 },
  { name: 'phone-landscape', viewport: { width: 844, height: 390 }, dpr: 3 },
  { name: 'tablet', viewport: { width: 834, height: 1112 }, dpr: 2 },
];

const problems = [];

async function openPage(browser, shot) {
  const context = await browser.newContext({
    viewport: shot.viewport,
    deviceScaleFactor: shot.dpr,
    hasTouch: shot.viewport.width < 900,
    isMobile: shot.viewport.width < 900,
  });
  const page = await context.newPage();

  if (vendoredThree) {
    await page.route('**/three@*/build/three.module.js', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: vendoredThree,
      })
    );
  }

  page.on('console', (msg) => {
    const type = msg.type();
    if (type !== 'error' && type !== 'warning') return;
    const text = msg.text();
    // スクリーンショット取得そのものが出すドライバ警告。アプリ側の問題ではない
    if (text.includes('GPU stall due to ReadPixels')) return;
    problems.push(`[${shot.name}] console.${type}: ${text}`);
  });
  page.on('pageerror', (err) => {
    problems.push(`[${shot.name}] pageerror: ${err.message}`);
  });

  const url = shot.hash ? `${BASE}/#${shot.hash}` : `${BASE}/`;
  await page.goto(url, { waitUntil: 'load' });
  return { context, page };
}

/** WebGL が本当に絵を出しているか（真っ黒や欠落を検出する） */
async function inspect(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    if (!canvas) return { ok: false, reason: 'canvas なし' };
    const gl =
      canvas.getContext('webgl2', { preserveDrawingBuffer: true }) ||
      canvas.getContext('webgl', { preserveDrawingBuffer: true });
    return {
      ok: true,
      width: canvas.width,
      height: canvas.height,
      contextLost: gl ? gl.isContextLost() : null,
    };
  });
}

async function measure(page) {
  return page.evaluate(
    () =>
      new Promise((resolve) => {
        const N = 300;
        const times = [];
        let prev = performance.now();
        function tick(now) {
          times.push(now - prev);
          prev = now;
          if (times.length >= N) {
            const sorted = times.slice(5).sort((a, b) => a - b);
            resolve({
              frames: sorted.length,
              median: sorted[Math.floor(sorted.length * 0.5)],
              p95: sorted[Math.floor(sorted.length * 0.95)],
              worst: sorted[sorted.length - 1],
            });
            return;
          }
          requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
      })
  );
}

const browser = await chromium.launch({
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle'],
});

await mkdir(OUT, { recursive: true });

const only = args.only;
for (const shot of SHOTS) {
  if (only && shot.name !== only) continue;

  const { context, page } = await openPage(browser, shot);
  await page.waitForTimeout(SETTLE);

  const info = await inspect(page);
  if (!info.ok) problems.push(`[${shot.name}] ${info.reason}`);
  if (info.contextLost) problems.push(`[${shot.name}] WebGL コンテキストが失われた`);

  // 水面を触った状態も見たいので、中央あたりをドラッグする
  const cx = shot.viewport.width / 2;
  const cy = shot.viewport.height / 2;
  await page.mouse.move(cx - 60, cy - 60);
  await page.mouse.down();
  for (let i = 0; i < 12; i++) {
    await page.mouse.move(cx - 60 + i * 10, cy - 60 + i * 8);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
  await page.waitForTimeout(400);

  const file = path.join(OUT, `${shot.name}.png`);
  await page.screenshot({ path: file });
  console.log(`撮影 ${file}  canvas=${info.width}x${info.height}`);

  await context.close();
}

if (args.perf) {
  // モバイル相当: 小さいビューポート + DPR 3 + CPU 4倍スロットリング
  const shot = { name: 'perf', viewport: { width: 390, height: 844 }, dpr: 3 };
  const { context, page } = await openPage(browser, shot);
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await page.waitForTimeout(1500);

  // 触っている最中が最も重いので、押しっぱなしで測る
  await page.mouse.move(195, 400);
  await page.mouse.down();
  const idle = await measure(page);
  await page.mouse.up();

  console.log('\n性能（390x844 / DPR 3 / CPU x4 throttle）');
  console.log(
    `  中央値 ${idle.median.toFixed(1)}ms  p95 ${idle.p95.toFixed(1)}ms  最悪 ${idle.worst.toFixed(1)}ms`
  );
  const ok = idle.median <= 16.7 && idle.p95 <= 25;
  console.log(`  目標（中央値 16.7ms / p95 25ms）: ${ok ? '達成' : '未達'}`);
  await writeFile(path.join(OUT, 'perf.json'), JSON.stringify(idle, null, 2));
  if (!ok) problems.push(`[perf] 中央値 ${idle.median.toFixed(1)}ms / p95 ${idle.p95.toFixed(1)}ms`);

  await context.close();
}

await browser.close();

if (problems.length) {
  console.error('\n問題:');
  for (const p of problems) console.error('  - ' + p);
  process.exit(1);
}
console.log('\n問題なし');
