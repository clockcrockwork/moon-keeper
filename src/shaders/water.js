export const waterVertex = /* glsl */ `
  attribute float waveHeight;
  varying float vHeight;
  varying vec2 vScreenUV;
  varying vec3 vWorldPos;
  varying vec3 vNormal;

  void main() {
    vHeight = waveHeight;

    vec3 pos = position;
    pos.y += waveHeight * 0.4;

    vWorldPos = (modelMatrix * vec4(pos, 1.0)).xyz;

    // 法線を波から推定（シンプル版。Phase 1 で高さテクスチャの中心差分に置き換える）
    vNormal = normalize(vec3(-waveHeight * 0.5, 1.0, -waveHeight * 0.3));

    vec4 clipPos = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
    vScreenUV = (clipPos.xy / clipPos.w) * 0.5 + 0.5;

    gl_Position = clipPos;
  }
`;

export const waterFragment = /* glsl */ `
  uniform sampler2D underwaterTex;
  uniform vec3 moonPos;
  uniform vec3 moonColor;
  uniform vec3 crestColor;
  uniform vec3 tintColor;
  uniform float cameraY;

  varying float vHeight;
  varying vec2 vScreenUV;
  varying vec3 vWorldPos;
  varying vec3 vNormal;

  void main() {
    // 波による屈折オフセット
    vec2 distortion = vNormal.xz * vHeight * 0.35;
    vec2 uv = clamp(vScreenUV + distortion, 0.0, 1.0);

    // 水中の映像（月と星空）を歪めて取得
    vec3 underwater = texture2D(underwaterTex, uv).rgb;

    // 月明かりの反射（控えめなスペキュラ）
    vec3 viewDir = normalize(vec3(0.0, cameraY, 0.0) - vWorldPos);
    vec3 lightDir = normalize(moonPos - vWorldPos);
    // 注意: ここは意図的に viewDir - lightDir。月は水面の「下」にあるため
    // lightDir はほぼ -Y、viewDir はほぼ +Y で、教科書どおりの normalize(V + L) は
    // ゼロベクトルの正規化になって破綻する。月を透かして見る輝きなので符号を反転する。
    vec3 halfDir = normalize(viewDir - lightDir);
    vec3 normal = normalize(vNormal);

    float spec = pow(max(dot(normal, halfDir), 0.0), 64.0);
    vec3 moonlightReflect = moonColor * spec * 0.25;

    // 波頭のハイライト
    float waveHighlight = smoothstep(0.01, 0.06, vHeight) * 0.55;
    vec3 highlight = crestColor * waveHighlight;

    // 水面の色味（エッジ部分のみ、中心は透明）
    float edgeFade = smoothstep(3.0, 8.0, length(vWorldPos.xz));
    vec3 waterTint = tintColor * edgeFade * 0.3;

    // 合成（水中の映像がメイン）
    vec3 finalColor = underwater + waterTint + moonlightReflect + highlight;

    // 波の谷は少し暗く
    float valleyDark = smoothstep(0.0, -0.08, vHeight) * 0.15;
    finalColor *= (1.0 - valleyDark);

    gl_FragColor = vec4(finalColor, 1.0);
  }
`;
