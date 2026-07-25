import * as THREE from 'three';
import { starfieldVertex, starfieldFragment } from '../shaders/starfield.js';

const STAR_COLOR = new THREE.Color(0.75, 0.8, 1.0);

/**
 * 星空。真上から見下ろすカメラに対して月よりさらに下（y = -20 〜 -35）に
 * 散らしてあるので、水中を透かした夜空として読める。
 */
export function createStarfield(state) {
  const geo = new THREE.BufferGeometry();
  const positions = [];
  const sizes = [];
  const alphas = [];

  for (let i = 0; i < state.stars.count; i++) {
    const x = (Math.random() - 0.5) * 50;
    const z = (Math.random() - 0.5) * 50;
    const y = -20 - Math.random() * 15;
    positions.push(x, y, z);
    sizes.push(0.4 + Math.random() * 0.8);

    // 中心から離れるほど明るい（月明かりで中心は白飛びして星が見えなくなる）
    const dist = Math.sqrt(x * x + z * z);
    alphas.push(Math.min(1, dist / 12) * 0.5 + 0.1);
  }

  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('size', new THREE.Float32BufferAttribute(sizes, 1));
  geo.setAttribute('alpha', new THREE.Float32BufferAttribute(alphas, 1));

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      time: { value: 0 },
      starColor: { value: STAR_COLOR.clone() },
      brightness: { value: state.stars.brightness },
      twinkleAmount: { value: state.stars.twinkle },
    },
    vertexShader: starfieldVertex,
    fragmentShader: starfieldFragment,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  const points = new THREE.Points(geo, mat);

  return {
    object: points,
    update(time) {
      mat.uniforms.time.value = time;
    },
    apply(s) {
      mat.uniforms.brightness.value = s.stars.brightness;
      mat.uniforms.twinkleAmount.value = s.stars.twinkle;
    },
    dispose() {
      geo.dispose();
      mat.dispose();
    },
  };
}
