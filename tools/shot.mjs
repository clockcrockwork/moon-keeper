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

  const base = shot.url ?? BASE;
  const url = shot.hash ? `${base}/#${shot.hash}` : `${base}/`;
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

  // 触っていない静かな水面
  const calmFile = path.join(OUT, `${shot.name}-calm.png`);
  await page.screenshot({ path: calmFile });

  // 設定タブが画面の端に接しているか。
  // 閉じているシートが幅を持つとタブが画面内側に取り残されるので、そこを見張る。
  {
    const tab = await page.evaluate(() => {
      const r = document.getElementById('panel-tab').getBoundingClientRect();
      return { right: r.right, bottom: r.bottom, w: innerWidth, h: innerHeight };
    });
    const mobile = shot.viewport.width <= 640;
    // モバイルは下端、PC は右端に貼り付く
    const gap = mobile ? Math.abs(tab.bottom - tab.h) : Math.abs(tab.right - tab.w);
    if (gap > 2) {
      problems.push(
        `[${shot.name}] 設定タブが${mobile ? '下' : '右'}端から ${gap.toFixed(0)}px 離れている`
      );
    }
  }

  const w = shot.viewport.width;
  const h = shot.viewport.height;

  // 連打しても波紋が消えないこと。
  // 以前はダブルタップが water.calm() に割り当たっていて、連打すると必ず
  // 成立して全部消えていた。同じ場所を6回叩いて波が残っているかを見る。
  {
    const cx = w * 0.5;
    const cy = h * 0.42;
    for (let i = 0; i < 6; i++) {
      await page.mouse.click(cx, cy);
      await page.waitForTimeout(90);
    }
    await page.waitForTimeout(260);
    await page.screenshot({ path: path.join(OUT, `${shot.name}-taps.png`) });

    // 触っている間はタブが引っ込むか。
    //
    // ここで見るのは `busy` クラスの付け外しだけにする。opacity の実測値は
    // 当てにならない: タブは backdrop-filter を持つのでコンポジタ側で
    // アニメーションし、SwiftShader で描画が渋滞していると
    // getComputedStyle が古い値（1）を返すことがある。
    // 実際に消えているかは触っている最中のスクリーンショットで目で見る。
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.waitForTimeout(150);
    const busyWhileDown = await page.evaluate(() =>
      document.getElementById('panel').classList.contains('busy')
    );
    await page.mouse.up();
    if (!busyWhileDown) {
      problems.push(`[${shot.name}] 触っている間もタブが引っ込まない`);
    }

    // 離したら戻るか（600ms 後に解除 → さらにフェードイン）
    await page.waitForTimeout(1600);
    const busyAfterUp = await page.evaluate(() =>
      document.getElementById('panel').classList.contains('busy')
    );
    if (busyAfterUp) {
      problems.push(`[${shot.name}] 離してもタブが戻らない`);
    }
  }

  // 1タップの輪が細く分かれて広がっていくか、時系列で3枚
  {
    await page.mouse.click(w * 0.34, h * 0.34);
    for (const [ms, tag] of [
      [380, 'ring1'],
      [700, 'ring2'],
      [900, 'ring3'],
    ]) {
      await page.waitForTimeout(ms);
      await page.screenshot({ path: path.join(OUT, `${shot.name}-${tag}.png`) });
    }
    await page.waitForTimeout(1400);
  }

  // 画面の端の近くをドラッグする。波が縁で跳ね返るかを見たいので、
  // わざと隅に寄せる。
  const sx = w * 0.28;
  const sy = h * 0.3;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  for (let i = 0; i < 14; i++) {
    await page.mouse.move(sx + i * (w * 0.03), sy + i * (h * 0.02));
    await page.waitForTimeout(16);
  }

  // 触っている最中（いちばん重く、いちばん動いている状態）
  const file = path.join(OUT, `${shot.name}.png`);
  await page.screenshot({ path: file });
  await page.mouse.up();

  // 離してしばらく後。波が広がって縁で反射しているはず
  await page.waitForTimeout(1100);
  const afterFile = path.join(OUT, `${shot.name}-after.png`);
  await page.screenshot({ path: afterFile });

  await context.close();

  // 操作パネルは本体のページを閉じてから別ページで撮る。
  // SwiftShader で WebGL のコンテキストを2つ同時に回すと描画が渋滞して
  // スクリーンショットがタイムアウトする。
  //
  // #panel=open で開いたまま固定される（自動退避が Playwright の待ち時間中に
  // 発火して、閉じた状態で写ってしまうのを防ぐ）。
  if (shot.panel !== false) {
    const panelPage = await openPage(browser, { ...shot, hash: 'panel=open' });
    await panelPage.page.waitForTimeout(1600);
    await panelPage.page.evaluate(() => {
      for (const d of document.querySelectorAll('#panel details')) d.open = true;
    });
    await panelPage.page.waitForTimeout(400);
    await panelPage.page.screenshot({ path: path.join(OUT, `${shot.name}-panel.png`) });
    await panelPage.context.close();
  }

  console.log(`撮影 ${file} (+calm/-taps/-ring1..3/-after/-panel)  canvas=${info.width}x${info.height}`);
}

if (args.perf) {
  // 重要な前提: この実行環境には GPU が無く、Chromium は SwiftShader
  // （ソフトウェアラスタライザ）で描いている。フラグメントシェーダのコストが
  // CPU に乗るので、絶対値は実機のスマホとまったく比例しない。
  //
  // したがって絶対値では合否を判定せず、同条件で測った基準版との「比」を見る。
  // --baseline に main 版を配信している URL を渡すと比較する。
  const RUNS = [
    // 小さく DPR 1 = フラグメントの量が少なく、JS とドライバ呼び出しの差が出る
    { name: 'cpu寄り', viewport: { width: 320, height: 640 }, dpr: 1 },
    // スマホ相当 = フラグメント量が支配的（SwiftShader では過大に出る）
    { name: 'fragment寄り', viewport: { width: 390, height: 844 }, dpr: 2 },
  ];

  const gl = await (async () => {
    const { context, page } = await openPage(browser, RUNS[0]);
    const info = await page.evaluate(() => {
      const c = document.querySelector('canvas');
      const g = c?.getContext('webgl2') || c?.getContext('webgl');
      const d = g?.getExtension('WEBGL_debug_renderer_info');
      return d ? g.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'unknown';
    });
    await context.close();
    return info;
  })();

  const software = /swiftshader|softwarerasterizer|llvmpipe/i.test(gl);
  console.log(`\n性能  GL: ${gl}`);
  if (software) {
    console.log('  ※ ソフトウェア描画なので絶対値は実機と比例しない。基準版との比だけを見る。');
  }

  async function run(url, spec) {
    const { context, page } = await openPage(browser, { ...spec, url });
    await page.waitForTimeout(1200);
    // 触っている最中がいちばん重い
    await page.mouse.move(spec.viewport.width / 2, spec.viewport.height / 2);
    await page.mouse.down();
    const r = await measure(page);
    await page.mouse.up();
    await context.close();
    return r;
  }

  const report = { gl, software, runs: {} };

  for (const spec of RUNS) {
    const mine = await run(BASE, spec);
    const line = [`  ${spec.name} (${spec.viewport.width}x${spec.viewport.height} @${spec.dpr})`];
    line.push(`現在 中央値 ${mine.median.toFixed(1)}ms / p95 ${mine.p95.toFixed(1)}ms`);
    report.runs[spec.name] = { current: mine };

    if (args.baseline) {
      const base = await run(args.baseline, spec);
      const ratio = mine.median / base.median;
      line.push(`基準 ${base.median.toFixed(1)}ms → 比 ${ratio.toFixed(2)}x`);
      report.runs[spec.name].baseline = base;
      report.runs[spec.name].ratio = ratio;
      // 基準の2倍より遅くなったら退行とみなす
      if (ratio > 2) problems.push(`[perf] ${spec.name} が基準の ${ratio.toFixed(2)} 倍に退行`);
    }
    console.log(line.join('  '));
  }

  await writeFile(path.join(OUT, 'perf.json'), JSON.stringify(report, null, 2));
}

await browser.close();

if (problems.length) {
  console.error('\n問題:');
  for (const p of problems) console.error('  - ' + p);
  process.exit(1);
}
console.log('\n問題なし');
