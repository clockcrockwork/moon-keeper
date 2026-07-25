import * as THREE from 'three';
import { starfieldVertex, starfieldFragment } from '../shaders/starfield.js';
import {
  milkyWayVertex,
  milkyWayFragment,
  shootingStarVertex,
  shootingStarFragment,
} from '../shaders/sky.js';

const SHOOTING_MIN_GAP = 26000;   // ms
const SHOOTING_MAX_GAP = 78000;
const SHOOTING_DURATION = 1250;

/**
 * 星空。真上から見下ろすカメラに対して月よりさらに下（y = -20 〜 -35）に
 * 散らしてあるので、水中を透かした夜空として読める。
 *
 * 天の川と流れ星も同じ水中シーンに置く。水面の屈折で一緒に歪むのが狙い。
 */
export function createStarfield(state, { camera }) {
  const group = new THREE.Group();

  // ---- 星 ----
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      time: { value: 0 },
      starColor: { value: new THREE.Color(state.stars.color) },
      brightness: { value: state.stars.brightness },
      twinkleAmount: { value: state.stars.twinkle },
    },
    vertexShader: starfieldVertex,
    fragmentShader: starfieldFragment,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  let geo = null;
  let points = null;
  let builtCount = -1;

  function buildStars(count) {
    const positions = [];
    const sizes = [];
    const alphas = [];

    for (let i = 0; i < count; i++) {
      const x = (Math.random() - 0.5) * 50;
      const z = (Math.random() - 0.5) * 50;
      const y = -20 - Math.random() * 15;
      positions.push(x, y, z);
      sizes.push(0.4 + Math.random() * 0.8);

      // 中心から離れるほど明るい（月明かりで中心は白飛びして星が見えなくなる）
      const dist = Math.sqrt(x * x + z * z);
      alphas.push(Math.min(1, dist / 12) * 0.5 + 0.1);
    }

    const next = new THREE.BufferGeometry();
    next.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    next.setAttribute('size', new THREE.Float32BufferAttribute(sizes, 1));
    next.setAttribute('alpha', new THREE.Float32BufferAttribute(alphas, 1));

    if (points) {
      points.geometry = next;
      geo?.dispose();
    } else {
      points = new THREE.Points(next, mat);
      points.frustumCulled = false;
      group.add(points);
    }
    geo = next;
    builtCount = count;
  }

  buildStars(state.stars.count);

  // ---- 天の川 ----
  const milkyMat = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(state.stars.color) },
      uStrength: { value: state.stars.milkyWay },
      uTime: { value: 0 },
    },
    vertexShader: milkyWayVertex,
    fragmentShader: milkyWayFragment,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  // 板は 1x1 で作って scale で合わせる。
  // 可視範囲より大きくしすぎると、帯ではなく画面全体の一様なもやになってしまう。
  const MILKY_DEPTH = 34;
  const milky = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), milkyMat);
  milky.rotation.x = -Math.PI / 2;
  milky.position.y = -MILKY_DEPTH;
  milky.frustumCulled = false;
  group.add(milky);

  function layoutMilkyWay() {
    const h =
      2 * (camera.position.y + MILKY_DEPTH) *
      Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5));
    // 少しだけ外へ余らせて、帯の端が画面内で切れないようにする
    milky.scale.set(h * camera.aspect * 1.15, h * 1.15, 1);
  }
  layoutMilkyWay();

  // ---- 流れ星 ----
  const shootMat = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(0xffffff) },
      uOpacity: { value: 0 },
    },
    vertexShader: shootingStarVertex,
    fragmentShader: shootingStarFragment,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const shoot = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), shootMat);
  shoot.rotation.x = -Math.PI / 2;
  shoot.visible = false;
  shoot.frustumCulled = false;
  group.add(shoot);

  let nextShootAt = performance.now() + SHOOTING_MIN_GAP;
  let shootStart = 0;
  const shootFrom = new THREE.Vector2();
  const shootTo = new THREE.Vector2();

  function launchShootingStar(now) {
    const angle = Math.random() * Math.PI * 2;
    const span = 16 + Math.random() * 14;
    // 画面の端から端へ抜けるように、中心から少し外した弦を引く
    const offset = (Math.random() - 0.5) * 16;
    shootFrom.set(
      Math.cos(angle) * -span * 0.5 - Math.sin(angle) * offset,
      Math.sin(angle) * -span * 0.5 + Math.cos(angle) * offset
    );
    shootTo.set(
      Math.cos(angle) * span * 0.5 - Math.sin(angle) * offset,
      Math.sin(angle) * span * 0.5 + Math.cos(angle) * offset
    );
    shoot.scale.set(span * 0.42, 0.5 + Math.random() * 0.4, 1);
    shoot.rotation.z = -angle;
    shootStart = now;
    shoot.visible = true;
  }

  return {
    object: group,

    update(time) {
      mat.uniforms.time.value = time;
      milkyMat.uniforms.uTime.value = time;

      const now = performance.now();

      if (!state.stars.shootingStars) {
        shoot.visible = false;
      } else if (!shoot.visible && now >= nextShootAt) {
        launchShootingStar(now);
      } else if (shoot.visible) {
        const t = (now - shootStart) / SHOOTING_DURATION;
        if (t >= 1) {
          shoot.visible = false;
          nextShootAt =
            now + SHOOTING_MIN_GAP + Math.random() * (SHOOTING_MAX_GAP - SHOOTING_MIN_GAP);
        } else {
          // 出て、走って、消える
          const envelope = Math.sin(Math.min(1, t) * Math.PI);
          shootMat.uniforms.uOpacity.value = envelope * 0.85 * state.stars.brightness;
          const x = THREE.MathUtils.lerp(shootFrom.x, shootTo.x, t);
          const z = THREE.MathUtils.lerp(shootFrom.y, shootTo.y, t);
          shoot.position.set(x, -26, z);
        }
      }
    },

    apply(s) {
      if (s.stars.count !== builtCount) buildStars(s.stars.count);
      mat.uniforms.starColor.value.set(s.stars.color);
      mat.uniforms.brightness.value = s.stars.brightness;
      mat.uniforms.twinkleAmount.value = s.stars.twinkle;
      milkyMat.uniforms.uColor.value.set(s.stars.color);
      milkyMat.uniforms.uStrength.value = s.stars.milkyWay;
      shootMat.uniforms.uColor.value.set(s.stars.color);
    },

    resize() {
      layoutMilkyWay();
    },

    /** 性能階層で天の川を落とす。 */
    applyTier(tier) {
      milky.visible = tier.milkyWay !== false;
    },

    dispose() {
      geo?.dispose();
      mat.dispose();
      milky.geometry.dispose();
      milkyMat.dispose();
      shoot.geometry.dispose();
      shootMat.dispose();
    },
  };
}
