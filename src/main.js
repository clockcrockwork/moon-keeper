import * as THREE from 'three';

import { state, applyState, onStateChange } from './state.js';
import { viewportSize, onViewportChange } from './viewport.js';
import { createStarfield } from './scene/stars.js';
import { createMoon } from './scene/moon.js';
import { createWater, WATER_SIZE } from './scene/water.js';
import { createInput, createOverlay } from './input.js';

// ========================================
// レンダラー・カメラ
// ========================================
const container = document.getElementById('container');
let { width, height } = viewportSize();

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(width, height);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
container.appendChild(renderer.domElement);

// メインカメラ（上から見下ろす）
const camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 100);
camera.position.set(0, 8, 0);
camera.lookAt(0, 0, 0);

// ========================================
// シーン1: 月と星空（水中の世界）
// ========================================
const underwaterScene = new THREE.Scene();
underwaterScene.background = new THREE.Color(state.sky.color);

const starfield = createStarfield(state);
underwaterScene.add(starfield.object);

const moon = createMoon(state);
underwaterScene.add(moon.object);

// 月と星空をテクスチャに焼くレンダーターゲット
const renderTarget = new THREE.WebGLRenderTarget(
  width * renderer.getPixelRatio(),
  height * renderer.getPixelRatio()
);

// ========================================
// シーン2: 水面（メインシーン）
// ========================================
const mainScene = new THREE.Scene();

const water = createWater(state, {
  underwaterTexture: renderTarget.texture,
  camera,
});
mainScene.add(water.mesh);

// ========================================
// インタラクション
// ========================================
const overlay = createOverlay();

createInput({
  domElement: renderer.domElement,
  camera,
  water,
  state,
  onFirstTouch: () => overlay.hide(),
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
  const dpr = renderer.getPixelRatio();
  renderTarget.setSize(width * dpr, height * dpr);
});

// ========================================
// アニメーション
// ========================================
// 波シミュは固定タイムステップで刻む。rAF 1回 = 1ステップにすると
// 120Hz の端末で波が倍速になってしまう。
const STEP = 1 / 60;
const MAX_STEPS_PER_FRAME = 2;   // 復帰時に巻き返そうとして更に重くなるのを防ぐ

let accumulator = 0;
let lastTime = performance.now();
let running = true;

function animate(now) {
  if (!running) return;
  requestAnimationFrame(animate);

  const time = now * 0.001;
  const dt = Math.min((now - lastTime) * 0.001, 0.25);
  lastTime = now;

  accumulator += dt;
  let steps = Math.floor(accumulator / STEP);
  if (steps > MAX_STEPS_PER_FRAME) {
    steps = MAX_STEPS_PER_FRAME;
    accumulator = 0;
  } else {
    accumulator -= steps * STEP;
  }
  water.step(steps);

  starfield.update(time);
  moon.update(time);

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

// 自然な波紋
setInterval(() => {
  const x = (Math.random() - 0.5) * WATER_SIZE * 0.7;
  const z = (Math.random() - 0.5) * WATER_SIZE * 0.7;
  water.createRipple(x, z, state.water.ambientStrength);
}, state.water.ambientInterval);
