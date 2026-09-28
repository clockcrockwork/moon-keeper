import * as THREE from 'three';

import { state, applyState, onStateChange, loadState } from './state.js';
import { viewportSize, onViewportChange } from './viewport.js';
import { createPerf } from './perf.js';
import { createStarfield } from './scene/stars.js';
import { createMoon } from './scene/moon.js';
import { createWater } from './scene/water.js';
import { createClock } from './scene/clock.js';
import { createDust } from './scene/dust.js';
import { createInput, createOverlay } from './input.js';
import { createPanel } from './ui/panel.js';

// 保存済み設定と、共有された URL ハッシュを先に読む
loadState();

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
  onTierChange: (settings) => {
    renderer.setPixelRatio(perf.pixelRatio());
    resizeRenderTarget();
    water.applyTier(settings);
    starfield.applyTier(settings);
    dust.applyTier(settings);
    moon.applyTier(settings);
  },
});
renderer.setPixelRatio(perf.pixelRatio());

// ========================================
// シーン1: 月・星空・時計（水中の世界）
// ========================================
const underwaterScene = new THREE.Scene();
underwaterScene.background = new THREE.Color(state.sky.color);

const starfield = createStarfield(state, { camera });
underwaterScene.add(starfield.object);

// 月の円盤とハローは水中には置かない（moon.js 参照）。水中に入るのは散乱光だけ
const moon = createMoon(state, { camera, tier: perf.settings() });
underwaterScene.add(moon.object);

const clock = createClock(state, { camera });
underwaterScene.add(clock.object);

const dust = createDust(state, { camera });
underwaterScene.add(dust.object);

// 水中の世界をテクスチャに焼くレンダーターゲット
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
  moonLayer: { texture: moon.layerTexture, rect: moon.layerRect },
  tier: perf.settings(),
});
mainScene.add(water.mesh);

water.applyTier(perf.settings());
starfield.applyTier(perf.settings());
dust.applyTier(perf.settings());

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
  // 水面を触っている間は設定のタブを引っ込める（クレジットと同じ考え方）
  onInteractStart: () => panel.setInteracting(true),
  onInteractEnd: () => panel.setInteracting(false),
});

const panel = createPanel({
  onQualityChange: (quality) => perf.setQuality(quality),
  onPhaseInfo: () => moon.phase,
  onCalm: () => water.calm(),
});

onStateChange((s) => {
  underwaterScene.background.set(s.sky.color);
  starfield.apply(s);
  moon.apply(s);
  water.apply(s);
  clock.apply(s);
  dust.apply(s);
});
applyState({ persist: false });
perf.setQuality(state.scene.quality);
panel.refresh();

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
  clock.resize();
  starfield.resize();
  dust.resize();
});

// ========================================
// アニメーション
// ========================================
// 波シミュは固定タイムステップで刻む。rAF 1回 = 1ステップにすると
// 120Hz の端末で波が倍速になってしまう。
const IDLE_MS = 30000;      // これだけ放置すると水が凪ぎ、タイトルがまた薄く浮かぶ

let accumulator = 0;
let lastTime = performance.now();
let running = true;
let idle = false;

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

  // 放置している間は水が凪ぐので、シミュレーションを間引く（見た目に影響しない）
  const nowIdle = water.idleMs > IDLE_MS;
  if (nowIdle !== idle) {
    idle = nowIdle;
    if (idle) overlay.show();
    else overlay.hide();
  }

  accumulator += dt;
  let steps = Math.floor(accumulator / stepSize);
  const maxSteps = idle ? 1 : settings.maxStepsPerFrame;
  if (steps > maxSteps) {
    steps = maxSteps;
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
  clock.update(moon.phase, water.energy);
  dust.update(time, water.energy);

  // 1) 月の反射レイヤー（月の円盤とハロー）を小さなターゲットに描画
  moon.renderLayer(renderer);

  // 2) 水中の世界をレンダーターゲットに描画
  renderer.setRenderTarget(renderTarget);
  renderer.render(underwaterScene, camera);

  // 3) 水面をメインに描画
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
