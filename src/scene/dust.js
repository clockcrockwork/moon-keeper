import * as THREE from 'three';

// 水中をゆっくり漂う塵。奥行きが出て、水の「厚み」が感じられるようになる。
// 水中シーンに置くので、これも水面の屈折で一緒に歪む。

const COUNT = 160;
const DEPTH_MIN = 1.2;
const DEPTH_MAX = 4.6;

const dustVertex = /* glsl */ `
  attribute float size;
  attribute float phase;
  attribute float speed;
  varying float vAlpha;
  uniform float uTime;
  uniform float uEnergy;

  void main() {
    vec3 p = position;

    // ゆっくり漂う。波を立てるとかき混ぜられて動きが増す
    float t = uTime * speed + phase;
    float stir = 1.0 + uEnergy * 2.5;
    p.x += sin(t * 0.7) * 0.28 * stir;
    p.z += cos(t * 0.53) * 0.28 * stir;
    p.y += sin(t * 0.31) * 0.16;

    // 明滅で「いま気づいた」感じを出す
    vAlpha = 0.25 + 0.75 * pow(max(sin(t * 0.9), 0.0), 3.0);

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = size * (90.0 / -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;

const dustFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vAlpha;

  void main() {
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;
    float soft = smoothstep(0.5, 0.0, d);
    gl_FragColor = vec4(uColor, soft * vAlpha * uOpacity);
  }
`;

export function createDust(state, { camera }) {
  const positions = [];
  const sizes = [];
  const phases = [];
  const speeds = [];

  for (let i = 0; i < COUNT; i++) {
    positions.push(0, -(DEPTH_MIN + Math.random() * (DEPTH_MAX - DEPTH_MIN)), 0);
    sizes.push(0.05 + Math.random() * 0.14);
    phases.push(Math.random() * Math.PI * 2);
    speeds.push(0.16 + Math.random() * 0.3);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('size', new THREE.Float32BufferAttribute(sizes, 1));
  geo.setAttribute('phase', new THREE.Float32BufferAttribute(phases, 1));
  geo.setAttribute('speed', new THREE.Float32BufferAttribute(speeds, 1));

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uEnergy: { value: 0 },
      uColor: { value: new THREE.Color(state.moon.color) },
      uOpacity: { value: 0.22 },
    },
    vertexShader: dustVertex,
    fragmentShader: dustFragment,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  const points = new THREE.Points(geo, material);
  points.frustumCulled = false;

  // 塵は画面いっぱいに散らしたいので、可視範囲に合わせて配り直す
  function layout() {
    const attr = geo.getAttribute('position');
    for (let i = 0; i < COUNT; i++) {
      const depth = -attr.getY(i);
      const h =
        2 * (camera.position.y + depth) * Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5));
      attr.setX(i, (Math.random() - 0.5) * h * camera.aspect);
      attr.setZ(i, (Math.random() - 0.5) * h);
    }
    attr.needsUpdate = true;
  }
  layout();

  return {
    object: points,

    update(time, energy) {
      material.uniforms.uTime.value = time;
      material.uniforms.uEnergy.value = energy;
    },

    resize() {
      layout();
    },

    apply(s) {
      material.uniforms.uColor.value.set(s.moon.color);
    },

    /** 低階層では切る。 */
    applyTier(tier) {
      points.visible = tier.dust !== false;
    },

    dispose() {
      geo.dispose();
      material.dispose();
    },
  };
}
