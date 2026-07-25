import * as THREE from 'three';

// 水中に沈む極細の明朝体デジタル時計。
//
// 狙いは実装の単純さそのもの: 数字を CanvasTexture に描いて水中シーンに置くだけで、
// 既存の RTT 経路を通って**水面の屈折で勝手に歪んで揺れる**。
// シェーダを足す必要はない。時計というよりは、水に沈んでいる物になる。

const CANVAS_WIDTH = 1024;
const CANVAS_HEIGHT = 320;

function pad(n) {
  return String(n).padStart(2, '0');
}

export function createClock(state, { camera }) {
  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_WIDTH;
  canvas.height = CANVAS_HEIGHT;
  const ctx = canvas.getContext('2d');

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;

  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    opacity: state.clock.opacity,
  });

  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
  mesh.rotation.x = -Math.PI / 2;

  const group = new THREE.Group();
  group.add(mesh);

  let lastText = '';
  let lastSub = '';

  function draw(text, sub) {
    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    const serif = '"Yu Mincho", "Hiragino Mincho ProN", "Songti SC", serif';

    // 滲みを足すために2度描く。加算合成なので薄く広がる
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.shadowColor = 'rgba(255, 255, 255, 0.55)';
    ctx.shadowBlur = 26;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.30)';
    ctx.font = `200 132px ${serif}`;
    ctx.fillText(text, CANVAS_WIDTH / 2, 130);

    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
    ctx.fillText(text, CANVAS_WIDTH / 2, 130);

    if (sub) {
      ctx.shadowColor = 'rgba(255, 255, 255, 0.4)';
      ctx.shadowBlur = 14;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.62)';
      ctx.font = `300 40px ${serif}`;
      ctx.fillText(sub, CANVAS_WIDTH / 2, 244);
      ctx.shadowBlur = 0;
    }

    texture.needsUpdate = true;
  }

  function layout() {
    // 月の手前、水面との間に置く。文字は可視幅の 6 割ほどに収める
    const depth = state.clock.depth;
    const visibleH =
      2 * (camera.position.y + depth) * Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5));
    const visibleW = visibleH * camera.aspect;
    const targetWidth = Math.min(visibleW, visibleH) * 0.62;
    mesh.scale.set(targetWidth, (targetWidth * CANVAS_HEIGHT) / CANVAS_WIDTH, 1);
    group.position.y = -depth;
  }

  layout();

  return {
    object: group,

    /**
     * 表示文字列が変わった時だけ描き直す。秒を出さないなら毎分1回で済む。
     * 波が立っている間は少し薄くする（波立つと読めなくなるのが自然）。
     */
    update(phase, energy = 0) {
      group.visible = state.clock.show;
      if (!state.clock.show) return;

      const now = new Date();
      const text = state.clock.seconds
        ? `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
        : `${pad(now.getHours())}:${pad(now.getMinutes())}`;

      const sub =
        state.clock.moonName && phase
          ? `${now.getMonth() + 1}月${now.getDate()}日　${phase.name}　月齢 ${phase.age.toFixed(1)}`
          : `${now.getMonth() + 1}月${now.getDate()}日`;

      if (text !== lastText || sub !== lastSub) {
        draw(text, sub);
        lastText = text;
        lastSub = sub;
      }

      material.opacity = state.clock.opacity * (1 - Math.min(energy, 1) * 0.45);
    },

    resize() {
      layout();
    },

    apply(s) {
      material.opacity = s.clock.opacity;
      group.visible = s.clock.show;
      layout();
      // 和名や秒の表示が切り替わったら次の update で描き直させる
      lastText = '';
      lastSub = '';
    },

    dispose() {
      mesh.geometry.dispose();
      material.dispose();
      texture.dispose();
    },
  };
}
