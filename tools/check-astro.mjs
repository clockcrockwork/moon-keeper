// 月相計算の検証。依存ゼロ。
//
//   node tools/check-astro.mjs
//
// 目で見ても正しさが判定できないのはここだけなので、この部分だけ自動検証する。
// 基準値は既知の朔望（新月・満月・上弦・下弦）の時刻（UTC）。

import { moonPhase, phaseFromSlider } from '../src/astro/moonPhase.js';

let failures = 0;

function check(label, actual, expected, tolerance) {
  const diff = Math.abs(actual - expected);
  const ok = diff <= tolerance;
  if (!ok) failures++;
  const mark = ok ? '  ok ' : 'FAIL ';
  console.log(
    `${mark}${label}: ${actual.toFixed(4)} (期待 ${expected.toFixed(4)} ±${tolerance})`
  );
}

/** phase01 は 0 と 1 が隣り合う循環量なので、循環距離で比べる。 */
function checkCyclic(label, actual, expected, tolerance) {
  const raw = Math.abs(actual - expected);
  const diff = Math.min(raw, 1 - raw);
  const ok = diff <= tolerance;
  if (!ok) failures++;
  console.log(
    `${ok ? '  ok ' : 'FAIL '}${label}: ${actual.toFixed(4)} (期待 ${expected.toFixed(4)} ±${tolerance}, 循環距離 ${diff.toFixed(4)})`
  );
}

// 既知の朔望の時刻（UTC）。出典: NASA / 国立天文台の暦要項が公表している値。
// 新月なら照明率 0、満月なら 1、上弦・下弦なら 0.5 になるはず。
const EVENTS = [
  ['2024-01-11T11:57Z', 'new', 0],
  ['2024-01-25T17:54Z', 'full', 1],
  ['2024-06-06T12:38Z', 'new', 0],
  ['2024-06-22T01:08Z', 'full', 1],
  ['2024-12-30T22:27Z', 'new', 0],
  ['2025-01-13T22:27Z', 'full', 1],
  ['2025-06-25T10:32Z', 'new', 0],
  ['2025-07-10T20:37Z', 'full', 1],
  ['2026-01-18T19:52Z', 'new', 0],
  ['2026-02-01T22:09Z', 'full', 1],
  // 上弦・下弦
  ['2025-01-06T23:56Z', 'first', 0.5],
  ['2025-01-21T20:31Z', 'last', 0.5],
  ['2025-07-02T19:30Z', 'first', 0.5],
  ['2025-07-18T00:38Z', 'last', 0.5],
];

console.log('照明率（既知の朔望の時刻で）');
for (const [iso, kind, expected] of EVENTS) {
  const p = moonPhase(new Date(iso));
  // 新月・満月の付近は照明率の変化が二次なので緩く、
  // 上弦・下弦の付近は一次で敏感なのでそれでも 0.02 に収まるべき
  const tol = kind === 'new' || kind === 'full' ? 0.005 : 0.02;
  check(`${iso} ${kind}`, p.illuminatedFraction, expected, tol);
}

console.log('\n満ち欠けの向き');
for (const [iso, kind] of EVENTS) {
  if (kind !== 'first' && kind !== 'last') continue;
  const p = moonPhase(new Date(iso));
  const shouldWax = kind === 'first';
  const ok = p.waxing === shouldWax;
  if (!ok) failures++;
  console.log(`${ok ? '  ok ' : 'FAIL '}${iso}: waxing=${p.waxing} (期待 ${shouldWax})`);
}

console.log('\n1朔望月を通した連続性');
{
  // 新月から次の新月まで、照明率が 0 → 1 → 0 と滑らかに動くこと。
  // 途中で不連続な跳びが無いことも見る。
  const start = new Date('2025-06-25T10:32Z').getTime();
  const step = 3600 * 1000;                       // 1時間
  let prev = moonPhase(new Date(start)).illuminatedFraction;
  let maxJump = 0;
  let peak = 0;
  let peakHour = -1;
  for (let hour = 1; hour <= 709; hour++) {
    const f = moonPhase(new Date(start + hour * step)).illuminatedFraction;
    maxJump = Math.max(maxJump, Math.abs(f - prev));
    if (f > peak) {
      peak = f;
      peakHour = hour;
    }
    prev = f;
  }
  check('1時間あたりの最大変化', maxJump, 0, 0.01);
  check('途中で満月になる（最大照明率）', peak, 1, 0.005);

  // 照明率が最大になる時刻が、実際の満月の時刻と一致すること。
  //
  // 平均朔望月の半分（14.77日）と比べてはいけない。近点距離の変化で
  // 新月→満月の間隔は 13.9〜15.6 日の幅で変わり、この朔望では実際に 15.42 日ある。
  const actualFull = new Date('2025-07-10T20:37Z').getTime();
  const expectedHours = (actualFull - start) / 3600000;
  check('照明率が最大になる時刻（実際の満月との差・時間）', peakHour, expectedHours, 1.5);
}

console.log('\nphase01 の対応');
{
  const cases = [
    [0, 0],
    [0.25, 0.5],
    [0.5, 1],
    [0.75, 0.5],
  ];
  for (const [p01, expected] of cases) {
    check(`phase01=${p01}`, phaseFromSlider(p01).illuminatedFraction, expected, 0.001);
  }
  // 実測の phase01 が既知の朔望と合っているか。
  //
  // 新月・満月の付近は位相角 i → phase01 の対応が非線形（照明率が i の
  // 二次で動く領域）なので、上弦・下弦より許容を緩く取る。
  // 新月では phase01 が 0 と 1 のどちらから近づくかが定まらないため循環距離で見る。
  checkCyclic('新月の phase01', moonPhase(new Date('2025-06-25T10:32Z')).phase01, 0, 0.02);
  check('満月の phase01', moonPhase(new Date('2025-07-10T20:37Z')).phase01, 0.5, 0.02);
  check('上弦の phase01', moonPhase(new Date('2025-07-02T19:30Z')).phase01, 0.25, 0.01);
}

console.log('\n欠けの傾き（観測地で変わること）');
{
  const d = new Date('2025-07-02T19:30Z');
  const tokyo = moonPhase(d, { lat: 35.68, lon: 139.77 });
  const sydney = moonPhase(d, { lat: -33.87, lon: 151.21 });
  const noObserver = moonPhase(d);

  // 位置を渡さなければパララクティック角は 0
  check('位置なしのパララクティック角', noObserver.parallacticAngle, 0, 1e-12);

  // 南半球では月が上下逆に見える。傾きは大きく違うはず
  const deltaDeg = Math.abs(
    ((tokyo.screenLimbAngle - sydney.screenLimbAngle) * 180) / Math.PI
  );
  const ok = deltaDeg > 60;
  if (!ok) failures++;
  console.log(
    `${ok ? '  ok ' : 'FAIL '}東京と南半球シドニーの傾き差: ${deltaDeg.toFixed(1)}° (期待 >60°)`
  );

  // 照明率は世界共通
  check('照明率は位置に依らない', tokyo.illuminatedFraction, sydney.illuminatedFraction, 1e-12);
}

console.log('\n和名');
for (const iso of ['2025-06-25T10:32Z', '2025-07-02T19:30Z', '2025-07-10T20:37Z']) {
  const p = moonPhase(new Date(iso));
  console.log(`     ${iso} → 月齢 ${p.age.toFixed(1)} 「${p.name}」`);
}

console.log(failures === 0 ? '\nすべて通過' : `\n${failures} 件 失敗`);
process.exit(failures === 0 ? 0 : 1);
