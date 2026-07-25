import * as THREE from 'three';
import { moonGlowVertex, moonGlowFragment } from '../shaders/moonGlow.js';

// state.moon.size は「月の直径が画面の短辺に占める割合」。
//
// 半径をワールド単位で固定すると、縦持ちのスマホでは月が画面幅を超えてしまう
// （FOV 50 / カメラ y=8 / 深さ 5 だと縦持ちで見える幅は 5.6 ワールド単位しかなく、
// 直径 4 の月は幅の 71% を占める）。歌詞は「小ぶりな月」なので、
// どのアスペクト比でも短辺に対する比を一定に保つ。
// 既定の 0.165 はデスクトップでの従来の見え方（画面高の約 33%）に合わせてある。

/** 月の深さで見える範囲の短辺。 */
function shortDimensionAtMoon(camera, depth) {
  const h = 2 * (camera.position.y + depth) * Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5));
  return Math.min(h, h * camera.aspect);
}

/**
 * 月。真上から見下ろすカメラに対してテクスチャが正しい向きで見えるよう、
 * pivot を X 軸に 90 度倒してから球を自転させている。
 */
export function createMoon(state, { camera }) {
  // 単位球を作って scale で大きさを決める。リサイズごとにジオメトリを作り直さない
  const geo = new THREE.SphereGeometry(1, 64, 64);
  const loader = new THREE.TextureLoader();
  const map = loader.load('./moon.webp', (t) => {
    t.colorSpace = THREE.SRGBColorSpace;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.anisotropy = 4;
    t.needsUpdate = true;
  });
  const mat = new THREE.MeshBasicMaterial({ map });
  const mesh = new THREE.Mesh(geo, mat);

  const initialSpin = Math.random() * Math.PI * 2;   // 見える経度を毎回変える

  const pivot = new THREE.Group();
  pivot.rotation.x = Math.PI / 2;
  pivot.add(mesh);

  // 淡いグロー。
  //
  // 元コードは `moon.position.y - 0.1` で「月のすぐ後ろ」を狙っていたが、
  // pivot 導入時に moon.position.y が pivot ローカルの 0 になったため、
  // 実際にはワールド y = -0.1（水面の直下）に置かれている。
  // これは意図とは違うが、結果として「水中に散乱した月明かり」の広いにじみになり、
  // 作者がこれまで見てきた絵そのものなので動かさない。
  // 月縁に張り付くハローは別レイヤとして Phase 2 で足す
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
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), glowMat);
  glow.rotation.x = -Math.PI / 2;

  const group = new THREE.Group();
  group.add(pivot);
  group.add(glow);

  let radius = 1;

  function layout() {
    radius = state.moon.size * shortDimensionAtMoon(camera, state.moon.depth);
    mesh.scale.setScalar(radius);
    pivot.position.set(0, -state.moon.depth, 0);
    glow.position.set(0, -0.1, 0);
    glow.scale.setScalar(radius * 10);
  }
  layout();

  return {
    object: group,
    /** 水面シェーダに渡す月のワールド座標 */
    worldPosition: new THREE.Vector3(0, -state.moon.depth, 0),
    get radius() {
      return radius;
    },

    update(time) {
      mesh.rotation.y = initialSpin + time * state.moon.spin;
    },

    /** ビューポートが変わった時。短辺に対する比を保つ。 */
    resize() {
      layout();
    },

    apply(s) {
      this.worldPosition.set(0, -s.moon.depth, 0);
      glowMat.uniforms.glowColor.value.set(s.moon.color);
      glowMat.uniforms.glowStrength.value = s.moon.glow;
      layout();
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
