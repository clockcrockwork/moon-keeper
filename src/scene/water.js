import * as THREE from 'three';
import { waterVertex, waterFragment } from '../shaders/water.js';
import { simVertex, simFragment } from '../shaders/waterSim.js';
import { simResolution } from '../perf.js';

const CREST_COLOR = new THREE.Color(0.7, 0.75, 0.9);

const SPLAT_SLOTS = 8;

// 水面は画面いっぱいにする。器は描かないので、端末の画面そのものが水槽の縁になる。
// 波の谷でも縁に隙間が出ないよう、可視範囲より僅かだけ大きく取る。
const MARGIN = 1.05;

/** カメラから y=0 面での可視範囲を逆算する。 */
export function worldSizeFor(camera) {
  const height = 2 * camera.position.y * Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5));
  return {
    width: height * camera.aspect * MARGIN,
    height: height * MARGIN,
  };
}

/** レンダーターゲットに使える浮動小数の型を選ぶ。 */
function pickFloatType(renderer) {
  const gl = renderer.getContext();
  const isWebGL2 = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
  const ext = renderer.extensions;

  if (isWebGL2) {
    if (ext.has('EXT_color_buffer_half_float')) return THREE.HalfFloatType;
    if (ext.has('EXT_color_buffer_float')) return THREE.FloatType;
  } else {
    if (ext.has('OES_texture_half_float') && ext.has('EXT_color_buffer_half_float')) {
      return THREE.HalfFloatType;
    }
    if (ext.has('OES_texture_float')) return THREE.FloatType;
  }
  return null;
}

/**
 * 水面。
 *
 * 波の高さ場は ping-pong する2枚のレンダーターゲットの上で GPU が解く。
 * CPU 版は毎フレーム数万回の JS ループでメインスレッドを占有していたので、
 * これはモバイルには純粋に有利（GPU 側の増分は更新パス1枚で、
 * そのコストは画面解像度ではなくシミュレーション解像度にしか比例しない）。
 *
 * 公開 API: { mesh, step, createRipple, calm, energy, resize, applyTier, apply, dispose }
 */
export function createWater(state, { renderer, camera, underwaterTexture, tier }) {
  const floatType = pickFloatType(renderer);
  const simEnabled = floatType !== null;
  if (!simEnabled) {
    console.warn(
      'moon-keeper: 浮動小数のレンダーターゲットが使えないため、波のシミュレーションを無効にします。' +
        '常時のうねりだけで水面を描きます。'
    );
  }

  let world = worldSizeFor(camera);
  let settings = tier;

  // ---- シミュレーション用のレンダーターゲット ----
  let targets = [];
  let current = 0;
  let simRes = { width: 1, height: 1 };

  function makeTargets() {
    const res = simResolution(settings.simTexels, world.width, world.height);
    simRes = res;
    for (const t of targets) t.dispose();
    targets = [0, 1].map(() =>
      new THREE.WebGLRenderTarget(res.width, res.height, {
        type: floatType,
        format: THREE.RGBAFormat,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        wrapS: THREE.ClampToEdgeWrapping,
        wrapT: THREE.ClampToEdgeWrapping,
        depthBuffer: false,
        stencilBuffer: false,
        generateMipmaps: false,
      })
    );
    // 両方をゼロで初期化しておく（ゴミが残っていると初回に暴れる）
    const prevTarget = renderer.getRenderTarget();
    const prevClear = new THREE.Color();
    renderer.getClearColor(prevClear);
    const prevAlpha = renderer.getClearAlpha();
    renderer.setClearColor(0x000000, 0);
    for (const t of targets) {
      renderer.setRenderTarget(t);
      renderer.clear(true, false, false);
    }
    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(prevClear, prevAlpha);
  }

  // ---- 更新パス（全画面クアッド。ジオメトリとカメラは使い回す） ----
  const emptySplat = () => new THREE.Vector4(0, 0, 1, 0);

  const simMaterial = new THREE.ShaderMaterial({
    defines: { SPLAT_SLOTS },
    uniforms: {
      uPrev: { value: null },
      uTexel: { value: new THREE.Vector2() },
      uTexelWorld: { value: new THREE.Vector2() },
      uWorldSize: { value: new THREE.Vector2() },
      uDamping: { value: 0.97 },
      uWaveSpeed: { value: 0.45 },
      uSplats: { value: Array.from({ length: SPLAT_SLOTS }, emptySplat) },
    },
    vertexShader: simVertex,
    fragmentShader: simFragment,
    depthTest: false,
    depthWrite: false,
  });

  const simScene = new THREE.Scene();
  const simCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const simQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), simMaterial);
  simQuad.frustumCulled = false;
  simScene.add(simQuad);

  // ---- 水面のメッシュ ----
  const zeroTexture = (() => {
    // シミュレーションが使えない環境用の、高さ0・勾配0のダミー
    const data = new Uint8Array([0, 0, 0, 255]);
    const tex = new THREE.DataTexture(data, 1, 1);
    tex.needsUpdate = true;
    return tex;
  })();

  const material = new THREE.ShaderMaterial({
    defines: {
      DETAIL_OCTAVES: settings.detailOctaves,
      ...(settings.caustics ? { CAUSTICS: '' } : {}),
    },
    uniforms: {
      uSim: { value: zeroTexture },
      uUnderwater: { value: underwaterTexture },
      uSimTexel: { value: new THREE.Vector2() },
      uHeightScale: { value: 0.4 },
      uSwell: { value: state.water.swell },
      uTime: { value: 0 },

      uCameraPos: { value: camera.position.clone() },
      uMoonPos: { value: new THREE.Vector3(0, -state.moon.depth, 0) },
      uMoonColor: { value: new THREE.Color(state.moon.color) },
      uCrestColor: { value: CREST_COLOR.clone() },
      uSkyColor: { value: new THREE.Color(state.sky.color) },

      uHalfWorld: { value: new THREE.Vector2() },
      uRefract: { value: state.water.refract },
      uFresnel: { value: state.water.fresnel },
      uSpecular: { value: state.water.specular },
      uCaustics: { value: state.water.caustics },
      uEnergy: { value: 0 },
    },
    vertexShader: waterVertex,
    fragmentShader: waterFragment,
  });

  let mesh = null;

  function buildGeometry() {
    const old = mesh?.geometry;
    // 分割数はワールドのアスペクト比に合わせる（縦長画面で縦だけ粗くならないように）
    const aspect = world.width / world.height;
    const segY = settings.segments;
    const segX = Math.max(8, Math.round(segY * aspect));
    const geo = new THREE.PlaneGeometry(world.width, world.height, segX, segY);
    geo.rotateX(-Math.PI / 2);
    if (mesh) {
      mesh.geometry = geo;
      old?.dispose();
    } else {
      mesh = new THREE.Mesh(geo, material);
      mesh.frustumCulled = false;
    }
  }

  function syncUniforms() {
    simMaterial.uniforms.uTexel.value.set(1 / simRes.width, 1 / simRes.height);
    simMaterial.uniforms.uTexelWorld.value.set(
      world.width / simRes.width,
      world.height / simRes.height
    );
    simMaterial.uniforms.uWorldSize.value.set(world.width, world.height);

    material.uniforms.uSimTexel.value.set(1 / simRes.width, 1 / simRes.height);
    material.uniforms.uHalfWorld.value.set(world.width * 0.5, world.height * 0.5);
  }

  if (simEnabled) makeTargets();
  buildGeometry();
  syncUniforms();

  // ---- 触点のキュー ----
  // 1ステップで最大 SPLAT_SLOTS 個を消費し、余りは次のステップへ回す。
  const splatQueue = [];

  /** ワールド座標 → シミュレーションの uv。uv.y は -z 方向を向く。 */
  function worldToUv(wx, wz) {
    return {
      u: 0.5 + wx / world.width,
      v: 0.5 - wz / world.height,
    };
  }

  function loadSplats() {
    const slots = simMaterial.uniforms.uSplats.value;
    for (let i = 0; i < SPLAT_SLOTS; i++) {
      const s = splatQueue.shift();
      if (s) slots[i].set(s.u, s.v, s.radius, s.strength);
      else slots[i].set(0, 0, 1, 0);   // 未使用。z は 0 にしない
    }
    return splatQueue.length;
  }

  // 触ったエネルギー。月の揺れと、月相に依存しないフィードバック光に配る
  let energy = 0;
  // 放置検出用
  let lastTouch = performance.now();

  return {
    get mesh() {
      return mesh;
    },
    get energy() {
      return energy;
    },
    get worldSize() {
      return { ...world };
    },
    get idleMs() {
      return performance.now() - lastTouch;
    },

    /** 固定タイムステップで steps 回進める。 */
    step(steps, time) {
      material.uniforms.uTime.value = time;
      material.uniforms.uEnergy.value = energy;
      energy *= 0.94;

      if (!simEnabled) return;

      simMaterial.uniforms.uDamping.value = state.water.damping;
      simMaterial.uniforms.uWaveSpeed.value = state.water.speed;

      // キューに触点が溜まっていたら、取りこぼさないだけのステップを回す。
      // 1ステップで SPLAT_SLOTS 個ずつ消費する。暴走しないよう上限を付ける。
      const needed = Math.ceil(splatQueue.length / SPLAT_SLOTS);
      const n = Math.min(Math.max(steps, needed), steps + 2);

      const prevTarget = renderer.getRenderTarget();
      for (let i = 0; i < n; i++) {
        loadSplats();
        simMaterial.uniforms.uPrev.value = targets[current].texture;
        renderer.setRenderTarget(targets[1 - current]);
        renderer.render(simScene, simCamera);
        current = 1 - current;
      }
      renderer.setRenderTarget(prevTarget);
      material.uniforms.uSim.value = targets[current].texture;
    },

    /**
     * 波紋を起こす。radius はワールド単位。
     * 高さを代入するのではなく速度へ加算するので、ドラッグを続けると波が積み上がる。
     */
    createRipple(wx, wz, strength = state.water.rippleStrength, radius = 0.45) {
      const { u, v } = worldToUv(wx, wz);
      if (u < -0.1 || u > 1.1 || v < -0.1 || v > 1.1) return;
      // 1ステップぶんのインパルス。ドラッグ中は毎フレーム積み上がるので控えめに
      splatQueue.push({ u, v, radius, strength: strength * 0.055 });
      energy = Math.min(1, energy + strength * 0.35);
      lastTouch = performance.now();
    },

    /** 水面を一気に静める（ダブルタップ用）。 */
    calm() {
      splatQueue.length = 0;
      energy = 0;
      if (!simEnabled) return;
      const prevTarget = renderer.getRenderTarget();
      const prevClear = new THREE.Color();
      renderer.getClearColor(prevClear);
      const prevAlpha = renderer.getClearAlpha();
      renderer.setClearColor(0x000000, 0);
      for (const t of targets) {
        renderer.setRenderTarget(t);
        renderer.clear(true, false, false);
      }
      renderer.setRenderTarget(prevTarget);
      renderer.setClearColor(prevClear, prevAlpha);
    },

    /** ビューポートが変わった時。水面を新しい可視範囲に合わせ直す。 */
    resize() {
      world = worldSizeFor(camera);
      material.uniforms.uCameraPos.value.copy(camera.position);
      if (simEnabled) makeTargets();
      buildGeometry();
      syncUniforms();
    },

    /** 性能階層が変わった時。 */
    applyTier(next) {
      settings = next;
      material.defines.DETAIL_OCTAVES = next.detailOctaves;
      if (next.caustics) material.defines.CAUSTICS = '';
      else delete material.defines.CAUSTICS;
      material.needsUpdate = true;
      if (simEnabled) makeTargets();
      buildGeometry();
      syncUniforms();
    },

    apply(s) {
      material.uniforms.uMoonPos.value.set(0, -s.moon.depth, 0);
      material.uniforms.uMoonColor.value.set(s.moon.color);
      material.uniforms.uSkyColor.value.set(s.sky.color);
      material.uniforms.uSwell.value = s.water.swell;
      material.uniforms.uRefract.value = s.water.refract;
      material.uniforms.uFresnel.value = s.water.fresnel;
      material.uniforms.uSpecular.value = s.water.specular;
      material.uniforms.uCaustics.value = s.water.caustics;
    },

    dispose() {
      mesh?.geometry.dispose();
      material.dispose();
      simMaterial.dispose();
      simQuad.geometry.dispose();
      zeroTexture.dispose();
      for (const t of targets) t.dispose();
    },
  };
}
