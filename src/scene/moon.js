import * as THREE from 'three';
import { moonGlowVertex, moonGlowFragment } from '../shaders/moonGlow.js';

/**
 * 月。真上から見下ろすカメラに対してテクスチャが正しい向きで見えるよう、
 * pivot を X 軸に 90 度倒してから球を自転させている。
 */
export function createMoon(state) {
  const geo = new THREE.SphereGeometry(state.moon.size, 64, 64);
  const loader = new THREE.TextureLoader();
  const map = loader.load('./moon.webp', (t) => {
    t.colorSpace = THREE.SRGBColorSpace;
  });
  const mat = new THREE.MeshBasicMaterial({ map });
  const mesh = new THREE.Mesh(geo, mat);

  const initialSpin = Math.random() * Math.PI * 2;   // 見える経度を毎回変える

  const pivot = new THREE.Group();
  pivot.position.set(0, -state.moon.depth, 0);
  pivot.rotation.x = Math.PI / 2;
  pivot.add(mesh);

  // 淡いグロー。
  //
  // 元コードは `moon.position.y - 0.1` で「月のすぐ後ろ」を狙っていたが、
  // pivot 導入時に moon.position.y が pivot ローカルの 0 になったため、
  // 実際にはワールド y = -0.1（水面の直下）に置かれている。
  // これは意図とは違うが、結果として「水中に散乱した月明かり」の広いにじみになり、
  // 作者がこれまで見てきた絵そのものなので Phase 0 では動かさない。
  // 月に張り付いたハローが欲しいなら Phase 2 で別レイヤとして足す
  // （散乱の広がりと月縁のハローは本来別物なので、分けた方が制御しやすい）。
  const glowMat = new THREE.ShaderMaterial({
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
  const glow = new THREE.Mesh(
    new THREE.PlaneGeometry(state.moon.size * 5, state.moon.size * 5),
    glowMat
  );
  glow.rotation.x = -Math.PI / 2;
  glow.position.set(0, -0.1, 0);

  const group = new THREE.Group();
  group.add(pivot);
  group.add(glow);

  return {
    object: group,
    /** 水面シェーダに渡す月のワールド座標 */
    worldPosition: new THREE.Vector3(0, -state.moon.depth, 0),

    update(time) {
      mesh.rotation.y = initialSpin + time * state.moon.spin;
    },

    apply(s) {
      pivot.position.y = -s.moon.depth;
      this.worldPosition.set(0, -s.moon.depth, 0);
      glowMat.uniforms.glowColor.value.set(s.moon.color);
      glowMat.uniforms.glowStrength.value = s.moon.glow;
    },

    dispose() {
      geo.dispose();
      mat.dispose();
      map.dispose();
      glow.geometry.dispose();
      glowMat.dispose();
    },
  };
}
