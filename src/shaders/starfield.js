export const starfieldVertex = /* glsl */ `
  attribute float size;
  attribute float alpha;
  varying float vAlpha;
  uniform float time;
  uniform float twinkleAmount;

  void main() {
    float twinkle = sin(time * 0.4 + position.x * 1.5 + position.z) * 0.2 * twinkleAmount + 0.8;
    vAlpha = alpha * twinkle;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = size * (120.0 / -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;

export const starfieldFragment = /* glsl */ `
  uniform vec3 starColor;
  uniform float brightness;
  varying float vAlpha;

  void main() {
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;
    float glow = smoothstep(0.5, 0.0, d);
    gl_FragColor = vec4(starColor, glow * vAlpha * brightness);
  }
`;
