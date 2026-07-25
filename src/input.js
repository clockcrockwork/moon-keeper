import * as THREE from 'three';

/**
 * ポインタ入力。マウスとタッチの二系統をやめて Pointer Events に一本化し、
 * setPointerCapture でドラッグが画面外へ出ても切れないようにする。
 */
export function createInput({ domElement, camera, water, state, onFirstTouch }) {
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const activePointers = new Set();

  function trace(event) {
    const rect = domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObject(water.mesh);
    if (hits.length > 0) {
      water.createRipple(hits[0].point.x, hits[0].point.z, state.water.rippleStrength);
    }
  }

  function onPointerDown(event) {
    // パネルなど UI の上での操作は水面に波紋を立てない
    if (event.target !== domElement) return;
    activePointers.add(event.pointerId);
    domElement.setPointerCapture(event.pointerId);
    trace(event);
    onFirstTouch?.();
  }

  function onPointerMove(event) {
    if (!activePointers.has(event.pointerId)) return;
    trace(event);
  }

  function onPointerUp(event) {
    activePointers.delete(event.pointerId);
    if (domElement.hasPointerCapture(event.pointerId)) {
      domElement.releasePointerCapture(event.pointerId);
    }
  }

  domElement.addEventListener('pointerdown', onPointerDown);
  domElement.addEventListener('pointermove', onPointerMove);
  domElement.addEventListener('pointerup', onPointerUp);
  domElement.addEventListener('pointercancel', onPointerUp);

  return {
    dispose() {
      domElement.removeEventListener('pointerdown', onPointerDown);
      domElement.removeEventListener('pointermove', onPointerMove);
      domElement.removeEventListener('pointerup', onPointerUp);
      domElement.removeEventListener('pointercancel', onPointerUp);
    },
  };
}

/** タイトル・ヒント・クレジットのフェードアウト。 */
export function createOverlay() {
  const ids = ['hint', 'title', 'credits'];
  let hidden = false;

  function hide() {
    if (hidden) return;
    hidden = true;
    for (const id of ids) document.getElementById(id)?.classList.add('hidden');
  }

  const timer = setTimeout(hide, 4000);

  return {
    hide() {
      clearTimeout(timer);
      hide();
    },
  };
}
