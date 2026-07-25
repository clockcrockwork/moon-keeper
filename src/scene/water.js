import * as THREE from 'three';
import { waterVertex, waterFragment } from '../shaders/water.js';

const CREST_COLOR = new THREE.Color(0.7, 0.75, 0.9);
const TINT_COLOR = new THREE.Color(0.01, 0.03, 0.08);

export const WATER_SIZE = 16;

/**
 * 水面。高さ場の波動方程式を CPU で解き、頂点属性として流し込む。
 *
 * 公開 API は Phase 1 の GPU 版と揃えてある:
 *   { mesh, step(dt), createRipple(x, z, strength), energy, apply(state), dispose() }
 */
export function createWater(state, { underwaterTexture, camera }) {
  const seg = state.water.segments;
  const stride = seg + 1;

  const height = new Float32Array(stride * stride);
  const velocity = new Float32Array(stride * stride);

  const geo = new THREE.PlaneGeometry(WATER_SIZE, WATER_SIZE, seg, seg);
  geo.rotateX(-Math.PI / 2);
  geo.setAttribute(
    'waveHeight',
    new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count), 1)
  );

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      underwaterTex: { value: underwaterTexture },
      moonPos: { value: new THREE.Vector3(0, -state.moon.depth, 0) },
      moonColor: { value: new THREE.Color(state.moon.color) },
      crestColor: { value: CREST_COLOR.clone() },
      tintColor: { value: TINT_COLOR.clone() },
      cameraY: { value: camera.position.y },
    },
    vertexShader: waterVertex,
    fragmentShader: waterFragment,
  });

  const mesh = new THREE.Mesh(geo, mat);
  const attr = geo.getAttribute('waveHeight');

  // 波の総エネルギー。月の揺れと触った時のフィードバックに配る
  let energy = 0;

  function stepOnce() {
    const damping = state.water.damping;
    const speed = state.water.speed;

    for (let j = 1; j < stride - 1; j++) {
      for (let i = 1; i < stride - 1; i++) {
        const idx = j * stride + i;
        const avg =
          (height[idx - 1] +
            height[idx + 1] +
            height[idx - stride] +
            height[idx + stride]) *
          0.25;

        velocity[idx] += (avg - height[idx]) * speed;
        velocity[idx] *= damping;
      }
    }

    // 境界反射（壁で跳ね返る）
    for (let i = 0; i < stride; i++) {
      height[i] = height[i + stride];
      height[(stride - 1) * stride + i] = height[(stride - 2) * stride + i];
      height[i * stride] = height[i * stride + 1];
      height[i * stride + stride - 1] = height[i * stride + stride - 2];
    }

    for (let i = 0; i < height.length; i++) {
      height[i] += velocity[i];
      height[i] = Math.max(-0.8, Math.min(0.8, height[i]));
    }
  }

  return {
    mesh,

    get energy() {
      return energy;
    },

    /**
     * 固定タイムステップで進める。dt に比例させると波の見た目が
     * リフレッシュレートで変わってしまうため、必ず一定間隔で刻む。
     */
    step(steps) {
      for (let n = 0; n < steps; n++) stepOnce();
      energy *= 0.92;

      for (let i = 0; i < attr.count; i++) attr.setX(i, height[i]);
      attr.needsUpdate = true;
    },

    createRipple(wx, wz, strength = state.water.rippleStrength) {
      const half = WATER_SIZE / 2;
      const gx = Math.floor(((wx + half) / WATER_SIZE) * seg);
      const gz = Math.floor(((wz + half) / WATER_SIZE) * seg);

      energy = Math.min(1, energy + strength * 0.6);

      const radius = 4;
      for (let dz = -radius; dz <= radius; dz++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const x = gx + dx;
          const z = gz + dz;
          if (x < 0 || x >= stride || z < 0 || z >= stride) continue;
          const dist = Math.sqrt(dx * dx + dz * dz);
          if (dist >= radius) continue;
          height[z * stride + x] = -(1 - dist / radius) * strength;
        }
      }
    },

    apply(s) {
      mat.uniforms.moonPos.value.set(0, -s.moon.depth, 0);
      mat.uniforms.moonColor.value.set(s.moon.color);
    },

    dispose() {
      geo.dispose();
      mat.dispose();
    },
  };
}
