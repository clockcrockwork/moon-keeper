import * as THREE from 'three';
import { moonGlowVertex, moonGlowFragment } from '../shaders/moonGlow.js';
import { moonVertex, moonFragment, moonHaloVertex, moonHaloFragment } from '../shaders/moon.js';
import { moonPhase, phaseFromSlider } from '../astro/moonPhase.js';
import { resolveLocation } from '../astro/location.js';

// state.moon.size は「月の直径が画面の短辺に占める割合」。
//
// 半径をワールド単位で固定すると、縦持ちのスマホでは月が画面幅を超えてしまう
// （FOV 50 / カメラ y=8 / 深さ 5 だと縦持ちで見える幅は 5.6 ワールド単位しかなく、
// 直径 4 の月は幅の 71% を占める）。歌詞は「小ぶりな月」なので、
// どのアスペクト比でも短辺に対する比を一定に保つ。
// 既定の 0.165 はデスクトップでの従来の見え方（画面高の約 33%）に合わせてある。

const EARTHSHINE_COLOR = new THREE.Color(0.35, 0.45, 0.7);

/** 月の深さで見える範囲の短辺。 */
function shortDimensionAtMoon(camera, depth) {
  const h = 2 * (camera.position.y + depth) * Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5));
  return Math.min(h, h * camera.aspect);
}

/**
 * 月。
 *
 * 「いとも簡単に捕獲された小ぶりな月が水面に浮かぶ」を実装する。
 * 欠けは現在時刻・現在地から計算した本物の月相。
 * 常にゆっくり漂い、波を立てれば揺すられ、長押しすれば指に付いてくる。
 */
export function createMoon(state, { camera, tier }) {
  // 単位球を作って scale で大きさを決める。リサイズごとにジオメトリを作り直さない
  const geo = new THREE.SphereGeometry(1, 64, 64);
  const loader = new THREE.TextureLoader();

  // 階層ごとにテクスチャの解像度を変える。2048x1024 は RGBA 展開と
  // ミップマップで VRAM 約10MB あり、低メモリのスマホでは無視できない。
  let mapUrl = '';
  let map = null;

  function loadMap(url) {
    if (url === mapUrl) return;
    const next = loader.load(url, (t) => {
      t.colorSpace = THREE.SRGBColorSpace;
      t.generateMipmaps = true;
      t.minFilter = THREE.LinearMipmapLinearFilter;
      t.anisotropy = 4;
      t.needsUpdate = true;
    });
    const prev = map;
    map = next;
    mapUrl = url;
    if (mat) mat.uniforms.uMap.value = next;
    prev?.dispose();
  }

  let mat = null;
  loadMap(tier.moonTexture);

  mat = new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: map },
      uSunDirView: { value: new THREE.Vector3(1, 0, 0) },
      uMoonColor: { value: new THREE.Color(state.moon.color) },
      uIntensity: { value: state.moon.intensity },
      uEarthshine: { value: state.moon.earthshine },
      uEarthshineColor: { value: EARTHSHINE_COLOR.clone() },
      uTerminatorSoft: { value: state.moon.terminatorSoft },
    },
    vertexShader: moonVertex,
    fragmentShader: moonFragment,
  });
  const mesh = new THREE.Mesh(geo, mat);

  const initialSpin = Math.random() * Math.PI * 2;   // 見える経度を毎回変える

  const pivot = new THREE.Group();
  pivot.rotation.x = Math.PI / 2;
  pivot.add(mesh);

  // 月を漂わせるための入れ物。pivot の向き合わせと分けておくと扱いやすい
  const drift = new THREE.Group();
  drift.add(pivot);

  // 水中に散乱した月明かりの広いにじみ。
  // 月の位置ではなく水面直下に置く（元コードがそうなっていて、
  // これが今の絵の主成分。月に重ねると円盤が白飛びする）。
  const scatterMat = new THREE.ShaderMaterial({
    uniforms: {
      glowColor: { value: new THREE.Color(state.moon.color) },
      glowStrength: { value: state.moon.glow },
    },
    vertexShader: moonGlowVertex,
    fragmentShader: moonGlowFragment,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const scatter = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), scatterMat);
  scatter.rotation.x = -Math.PI / 2;

  // 月縁に張り付くハロー。円盤の内側は抜いてある
  const haloMat = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(state.moon.color) },
      uStrength: { value: state.moon.halo },
      uInner: { value: 0.42 },
    },
    vertexShader: moonHaloVertex,
    fragmentShader: moonHaloFragment,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const halo = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), haloMat);

  const group = new THREE.Group();
  group.add(drift);
  group.add(scatter);
  group.add(halo);

  let radius = 1;

  function layout() {
    radius = state.moon.size * shortDimensionAtMoon(camera, state.moon.depth);
    mesh.scale.setScalar(radius);
    scatter.position.set(0, -0.1, 0);
    scatter.scale.setScalar(radius * 10);
    // ハローは円盤の 2.4 倍の板に、内側 1/2.4 を抜いた輪を描く
    halo.scale.setScalar(radius * 4.8);
    haloMat.uniforms.uInner.value = 1 / 2.4;
  }

  // ---- 月相 ----
  let phase = null;
  let phaseCheckedAt = 0;

  function refreshPhase(now = performance.now()) {
    const observer = resolveLocation(state.location);
    const real = moonPhase(new Date(), observer);

    if (state.moon.phaseMode === 'manual') {
      const manual = phaseFromSlider(state.moon.phaseManual);
      // 欠けの傾きは実際の空のものを使う。手で変えるのは「満ち欠け」だけ
      phase = { ...manual, screenLimbAngle: real.screenLimbAngle };
    } else {
      phase = real;
    }
    phaseCheckedAt = now;

    // 画面右向きから反時計回りに screenLimbAngle、+z がカメラ側。
    // 位相角 i が 0 なら太陽はカメラ側（満月）、π なら向こう側（新月）。
    const i = phase.phaseAngle;
    mat.uniforms.uSunDirView.value
      .set(
        Math.sin(i) * Math.cos(phase.screenLimbAngle),
        Math.sin(i) * Math.sin(phase.screenLimbAngle),
        Math.cos(i)
      )
      .normalize();

    // 照明率に応じて明かりの量を変える（Moon-driven light）
    const f = phase.illuminatedFraction;
    scatterMat.uniforms.glowStrength.value = state.moon.glow * (0.25 + 0.75 * Math.pow(f, 0.7));
    haloMat.uniforms.uStrength.value = state.moon.halo * (0.15 + 0.85 * Math.pow(f, 0.8));
  }

  layout();
  refreshPhase();

  // ---- 漂い ----
  // 互いに非整数比の周期で、決して同じ場所に戻らないように。
  //
  // 月は「空の月が水面に映っているもの」なので、自分から動き回るのはおかしい。
  // 漂いは水面が揺れているぶんだけに留め、位置を変えたい時は
  // state.moon.offsetX / offsetZ（パネルの「位置」）で決める。
  const worldPosition = new THREE.Vector3(0, -state.moon.depth, 0);
  const tiltTarget = new THREE.Vector2(0, 0);
  const tilt = new THREE.Vector2(0, 0);

  /** offsetX / offsetZ（-1〜1）を月の深さでのワールド座標に直す。 */
  function offsetWorld() {
    const h =
      2 * (camera.position.y + state.moon.depth) *
      Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5));
    return {
      x: state.moon.offsetX * h * camera.aspect * 0.5,
      z: state.moon.offsetZ * h * 0.5,
    };
  }

  return {
    object: group,
    worldPosition,
    get radius() {
      return radius;
    },
    get phase() {
      return phase;
    },

    update(time, { energy = 0, pointerVelocity = null, dt = 0.016 } = {}) {
      // 数分ごとに月相を再計算する（毎フレームは不要）
      const now = performance.now();
      if (state.moon.phaseMode === 'auto' && now - phaseCheckedAt > 120000) {
        refreshPhase(now);
      }

      // 秤動: ごく僅かな2軸の揺れを自転に重ねる
      mesh.rotation.y = initialSpin + time * state.moon.spin + Math.sin(time * 0.031) * 0.05;
      mesh.rotation.x = Math.sin(time * 0.047) * 0.04;

      // 漂い（リサージュ）。振幅は月の半径に対する比で持つ
      const amp = radius * state.moon.driftAmount;
      const driftX = Math.sin(time / 37) * amp + Math.sin(time / 11.3) * amp * 0.25;
      const driftZ = Math.cos(time / 53) * amp + Math.cos(time / 17.7) * amp * 0.25;

      // 浮き沈み。波を立てると月が揺すられる
      const bob = Math.sin(time * 0.43) * radius * 0.05 + energy * radius * 0.22;

      const offset = offsetWorld();
      drift.position.set(driftX + offset.x, bob, driftZ + offset.z);
      worldPosition.set(drift.position.x, -state.moon.depth + bob, drift.position.z);
      pivot.position.set(0, -state.moon.depth, 0);

      // 払った方向にごく僅かかしぐ（水面が傾くぶん）
      if (pointerVelocity) {
        const cap = state.moon.tiltAmount;
        tiltTarget.set(
          THREE.MathUtils.clamp(pointerVelocity.y * 0.012, -cap, cap),
          THREE.MathUtils.clamp(-pointerVelocity.x * 0.012, -cap, cap)
        );
      } else {
        tiltTarget.set(0, 0);
      }
      tilt.lerp(tiltTarget, 1 - Math.pow(0.08, dt));
      drift.rotation.x = tilt.x;
      drift.rotation.z = tilt.y;

      // 散乱とハローは月に追従させる
      scatter.position.x = drift.position.x * 0.6;
      scatter.position.z = drift.position.z * 0.6;
      halo.position.set(drift.position.x, -state.moon.depth + bob, drift.position.z);
      halo.quaternion.copy(camera.quaternion);
    },

    /** ビューポートが変わった時。短辺に対する比を保つ。 */
    resize() {
      layout();
    },

    /** 性能階層でテクセル数を落とす。 */
    applyTier(next) {
      loadMap(next.moonTexture);
    },

    apply(s) {
      mat.uniforms.uMoonColor.value.set(s.moon.color);
      mat.uniforms.uIntensity.value = s.moon.intensity;
      mat.uniforms.uEarthshine.value = s.moon.earthshine;
      mat.uniforms.uTerminatorSoft.value = s.moon.terminatorSoft;
      scatterMat.uniforms.glowColor.value.set(s.moon.color);
      haloMat.uniforms.uColor.value.set(s.moon.color);
      layout();
      refreshPhase();
    },

    dispose() {
      geo.dispose();
      mat.dispose();
      map.dispose();
      scatter.geometry.dispose();
      scatterMat.dispose();
      halo.geometry.dispose();
      haloMat.dispose();
    },
  };
}
