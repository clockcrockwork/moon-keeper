import * as THREE from 'three';

import { state, applyState, onStateChange } from './state.js';
import { viewportSize, onViewportChange } from './viewport.js';
import { createPerf } from './perf.js';
import { createStarfield } from './scene/stars.js';
import { createMoon } from './scene/moon.js';
import { createWater } from './scene/water.js';
import { createInput, createOverlay } from './input.js';

// ========================================
// レンダラー・カメラ
// ========================================
const container = document.getElementById('container');
let { width, height } = viewportSize();

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(width, height);
container.appendChild(renderer.domElement);

// メインカメラ（上から見下ろす）
const camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 100);
camera.position.set(0, 8, 0);
camera.lookAt(0, 0, 0);

// ========================================
// 性能階層
// ========================================
const perf = createPerf(renderer, {
  onTierChange: (settings, info) => {
    renderer.setPixelRatio(perf.pixelRatio());
    resizeRenderTarget();
    water.applyTier(settings);
    console.info(`moon-keeper: 品質を ${settings.label} に変更 (${info.reason})`);
  },
});
renderer.setPixelRatio(perf.pixelRatio());

// ========================================
// シーン1: 月と星空（水中の世界）
// ========================================
const underwaterScene = new THREE.Scene();
underwaterScene.background = new THREE.Color(state.sky.color);

const starfield = createStarfield(state);
underwaterScene.add(starfield.object);

const moon = createMoon(state, { camera });
underwaterScene.add(moon.object);

// 月と星空をテクスチャに焼くレンダーターゲット
const renderTarget = new THREE.WebGLRenderTarget(1, 1, {
  depthBuffer: true,
  stencilBuffer: false,
});

function resizeRenderTarget() {
  const dpr = renderer.getPixelRatio();
  renderTarget.setSize(Math.max(1, Math.round(width * dpr)), Math.max(1, Math.round(height * dpr)));
}
resizeRenderTarget();

// ========================================
// シーン2: 水面（メインシーン）
// ========================================
const mainScene = new THREE.Scene();

const water = createWater(state, {
  renderer,
  camera,
  underwaterTexture: renderTarget.texture,
  tier: perf.settings(),
});
mainScene.add(water.mesh);

// ========================================
// インタラクション
// ========================================
const overlay = createOverlay();

const input = createInput({
  domElement: renderer.domElement,
  camera,
  water,
  state,
  onFirstTouch: () => overlay.hide(),
  // 長押しで月を掬う。「いとも簡単に捕獲された」
  onScoop: (x, z) => moon.hold(x, z),
  onScoopEnd: () => moon.release(),
});

onStateChange((s) => {
  underwaterScene.background.set(s.sky.color);
  starfield.apply(s);
  moon.apply(s);
  water.apply(s);
});
applyState();

// ========================================
// リサイズ
// ========================================
onViewportChange((size) => {
  width = size.width;
  height = size.height;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
  renderer.setPixelRatio(perf.pixelRatio());
  resizeRenderTarget();
  // 水面を新しい可視範囲に合わせ直す。画面の四辺が水槽の縁になる。
  water.resize();
  // 月は画面の短辺に対する比を保つ（縦持ちで画面幅を超えないように）
  moon.resize();
});

// ========================================
// アニメーション
// ========================================
// 波シミュは固定タイムステップで刻む。rAF 1回 = 1ステップにすると
// 120Hz の端末で波が倍速になってしまう。
let accumulator = 0;
let lastTime = performance.now();
let running = true;

function animate(now) {
  if (!running) return;
  requestAnimationFrame(animate);

  const frameMs = now - lastTime;
  lastTime = now;
  perf.sample(frameMs, now);

  const time = now * 0.001;
  const dt = Math.min(frameMs * 0.001, 0.25);
  const settings = perf.settings();
  const stepSize = 1 / settings.stepHz;

  accumulator += dt;
  let steps = Math.floor(accumulator / stepSize);
  if (steps > settings.maxStepsPerFrame) {
    steps = settings.maxStepsPerFrame;
    accumulator = 0;
  } else {
    accumulator -= steps * stepSize;
  }

  water.step(steps, time);
  starfield.update(time);
  moon.update(time, {
    energy: water.energy,
    pointerVelocity: input.isDown ? input.velocity : null,
    dt,
  });
  // 月が漂うので、水面の透過ハイライトも一緒に動かす
  water.setMoonPosition(moon.worldPosition);

  // 1) 月と星空をレンダーターゲットに描画
  renderer.setRenderTarget(renderTarget);
  renderer.render(underwaterScene, camera);

  // 2) 水面をメインに描画
  renderer.setRenderTarget(null);
  renderer.render(mainScene, camera);
}

requestAnimationFrame(animate);

// タブが隠れている間は回さない（バッテリーに直結）
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    running = false;
  } else if (!running) {
    running = true;
    lastTime = performance.now();
    accumulator = 0;
    requestAnimationFrame(animate);
  }
});

// 自然な波紋。放置している間もときどき水面が動く
setInterval(() => {
  if (document.hidden) return;
  const size = water.worldSize;
  const x = (Math.random() - 0.5) * size.width * 0.8;
  const z = (Math.random() - 0.5) * size.height * 0.8;
  water.createRipple(x, z, state.water.ambientStrength, 0.6);
}, state.water.ambientInterval);
