import * as THREE from 'three';

const HOLD_INTERVAL_MS = 40;        // 押しっぱなしで水を凹ませ続ける間隔
const INTERACT_RELEASE_MS = 600;    // 離してからこれだけ経ったら「触っていない」に戻す

/**
 * ポインタ入力。マウスとタッチの二系統をやめて Pointer Events に一本化し、
 * setPointerCapture でドラッグが画面外へ出ても切れないようにする。
 *
 * 払う速さで波紋の大きさと強さが変わる。速く払えば大きく崩れ、
 * そっと触ればさざなみが立つ。
 *
 * ここに置かないもの:
 * - ダブルタップで水面を静める → 連打すると必ず成立して波紋が全部消えてしまう。
 *   連打はいちばん波が溜まってほしい操作なので、静めるのはパネルのボタンへ移した。
 * - 長押しで月を掬う → 月は「水の中の物」ではなく「空の月が水面に映っているもの」。
 *   掴んで動かせると、その関係が壊れる。位置を変えたい時はパネルから。
 */
export function createInput({
  domElement,
  camera,
  water,
  state,
  onFirstTouch,
  onInteractStart,
  onInteractEnd,
}) {
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hit = new THREE.Vector3();

  let activeId = null;
  let last = null;                  // { x, z, t }
  let holdTimer = 0;
  let releaseTimer = 0;
  let interacting = false;

  // 平滑化したポインタ速度。月をわずかに傾けるのに使う
  const velocity = new THREE.Vector2();

  /**
   * 画面座標から水面（y=0 平面）上の点を求める。
   * メッシュへのレイキャストではなく平面との交点にする。頂点の変位は
   * シェーダ側でしか起きていないので、平面と交差させた方が安定して速い。
   */
  function toWorld(event) {
    const rect = domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    return raycaster.ray.intersectPlane(plane, hit) ? hit : null;
  }

  function beginInteract() {
    clearTimeout(releaseTimer);
    if (interacting) return;
    interacting = true;
    onInteractStart?.();
  }

  function endInteract() {
    // 指を上げた瞬間に戻すとチラつくので、少し置いてから
    clearTimeout(releaseTimer);
    releaseTimer = setTimeout(() => {
      interacting = false;
      onInteractEnd?.();
    }, INTERACT_RELEASE_MS);
  }

  function splash(point, now) {
    let speed = 0;
    if (last) {
      const dt = Math.max(now - last.t, 8) / 1000;
      speed = Math.hypot(point.x - last.x, point.z - last.z) / dt;
      velocity.set((point.x - last.x) / dt, (point.z - last.z) / dt);
    }
    last = { x: point.x, z: point.z, t: now };

    // 速く払うほど大きく、強く崩れる
    const t = Math.min(speed / 14, 1);
    const radius = state.water.rippleRadius * (1 + t * 1.6);
    const strength = state.water.rippleStrength * (0.55 + t * 1.1);
    water.createRipple(point.x, point.z, strength, radius);
  }

  function onPointerDown(event) {
    // パネルなど UI の上での操作は水面に波紋を立てない
    if (event.target !== domElement) return;

    const point = toWorld(event);
    if (!point) return;

    activeId = event.pointerId;
    domElement.setPointerCapture(event.pointerId);
    last = null;
    beginInteract();
    splash(point, event.timeStamp || performance.now());
    onFirstTouch?.();

    // 押しっぱなしなら、その場を凹ませ続ける（離すと表面張力で跳ね返る）
    holdTimer = setInterval(() => {
      if (!last) return;
      water.createRipple(
        last.x,
        last.z,
        state.water.rippleStrength * 0.32,
        state.water.rippleRadius * 1.3
      );
    }, HOLD_INTERVAL_MS);
  }

  function onPointerMove(event) {
    if (event.pointerId !== activeId) return;
    const point = toWorld(event);
    if (point) splash(point, event.timeStamp || performance.now());
  }

  function onPointerUp(event) {
    if (event.pointerId !== activeId) return;
    activeId = null;
    last = null;
    velocity.set(0, 0);
    clearInterval(holdTimer);
    holdTimer = 0;
    endInteract();
    if (domElement.hasPointerCapture(event.pointerId)) {
      domElement.releasePointerCapture(event.pointerId);
    }
  }

  domElement.addEventListener('pointerdown', onPointerDown);
  domElement.addEventListener('pointermove', onPointerMove);
  domElement.addEventListener('pointerup', onPointerUp);
  domElement.addEventListener('pointercancel', onPointerUp);

  return {
    /** 平滑化したポインタ速度（ワールド単位/秒）。月の傾きに使う。 */
    velocity,
    get isDown() {
      return activeId !== null;
    },
    dispose() {
      clearInterval(holdTimer);
      clearTimeout(releaseTimer);
      domElement.removeEventListener('pointerdown', onPointerDown);
      domElement.removeEventListener('pointermove', onPointerMove);
      domElement.removeEventListener('pointerup', onPointerUp);
      domElement.removeEventListener('pointercancel', onPointerUp);
    },
  };
}

/** タイトル・ヒント・クレジットのフェード。放置すると再び薄く現れる。 */
export function createOverlay() {
  const nodes = ['hint', 'title', 'credits'].map((id) => document.getElementById(id));
  let autoTimer = setTimeout(hide, 4000);

  function hide() {
    clearTimeout(autoTimer);
    for (const el of nodes) el?.classList.add('hidden');
  }

  function show({ hintToo = false } = {}) {
    for (const el of nodes) {
      if (!hintToo && el?.id === 'hint') continue;
      el?.classList.remove('hidden');
    }
  }

  return { hide, show };
}
