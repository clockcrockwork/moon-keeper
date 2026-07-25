export const moonGlowVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const moonGlowFragment = /* glsl */ `
  uniform vec3 glowColor;
  uniform float glowStrength;
  varying vec2 vUv;

  void main() {
    float dist = length(vUv - 0.5) * 2.0;
    float glow = smoothstep(1.0, 0.3, dist) * glowStrength;
    gl_FragColor = vec4(glowColor, glow);
  }
`;
