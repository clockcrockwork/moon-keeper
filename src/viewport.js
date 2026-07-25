// ビューポートの実寸を一箇所で扱う。
//
// window.innerHeight は iOS Safari の URL バーの出入りで変動し、resize が連射される。
// Phase 1 で水面の大きさを可視範囲に一致させるので、ここがぶれると水面に隙間が出る。
// visualViewport を優先し、変更通知は rAF でまとめて1回にする。

/** 現在のビューポート実寸（CSS ピクセル）。 */
export function viewportSize() {
  const vv = window.visualViewport;
  return {
    width: Math.max(1, Math.round(vv ? vv.width : window.innerWidth)),
    height: Math.max(1, Math.round(vv ? vv.height : window.innerHeight)),
  };
}

const listeners = new Set();
let pending = 0;
let last = viewportSize();

function schedule() {
  if (pending) return;
  pending = requestAnimationFrame(() => {
    pending = 0;
    const size = viewportSize();
    // URL バーのスクロールで同じ値の resize が何度も来るので、変化した時だけ通す
    if (size.width === last.width && size.height === last.height) return;
    last = size;
    for (const fn of listeners) fn(size);
  });
}

/** ビューポートの寸法が実際に変わった時だけ呼ばれる。戻り値を呼ぶと解除。 */
export function onViewportChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

window.addEventListener('resize', schedule);
window.addEventListener('orientationchange', schedule);
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', schedule);
}
