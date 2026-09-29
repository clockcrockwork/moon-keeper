import { PRESETS, applyPreset, applyState, getPath, setPath, shareUrl } from './state.js';

const COLOR_RE = /^#[0-9a-f]{6}$/i;

const EXPOSED = {
  moon: {
    color: { type: 'color', description: '月明かりの色。#RRGGBB。' },
    intensity: { type: 'number', min: 0, max: 2, description: '月の明るさ。' },
    size: { type: 'number', min: 0.05, max: 0.45, description: '画面短辺に対する月の大きさ。' },
    depth: { type: 'number', min: 1.5, max: 9, description: '水面越しに見える月の深さ。' },
    glow: { type: 'number', min: 0, max: 0.4, description: '月明かりの広いにじみ。' },
    halo: { type: 'number', min: 0, max: 0.4, description: '月縁のハロー。' },
    earthshine: { type: 'number', min: 0, max: 0.25, description: '暗部に残る地球照。' },
    driftAmount: { type: 'number', min: 0, max: 0.6, description: '月のわずかな漂い。' },
    offsetX: { type: 'number', min: -1, max: 1, description: '月の横位置。' },
    offsetZ: { type: 'number', min: -1, max: 1, description: '月の縦位置。' },
    phaseMode: {
      type: 'enum',
      values: ['auto', 'manual'],
      description: 'auto=今夜の月相、manual=手動。',
    },
    phaseManual: { type: 'number', min: 0, max: 1, description: '手動月相。0〜1。' },
  },
  stars: {
    color: { type: 'color', description: '星の色。#RRGGBB。' },
    count: { type: 'integer', min: 0, max: 900, description: '星の数。' },
    brightness: { type: 'number', min: 0, max: 2.5, description: '星の明るさ。' },
    twinkle: { type: 'number', min: 0, max: 3, description: '星の瞬き。' },
    shootingStars: { type: 'boolean', description: '流れ星を有効にするか。' },
    milkyWay: { type: 'number', min: 0, max: 1, description: '天の川の濃さ。' },
  },
  water: {
    damping: {
      type: 'number',
      min: 0.93,
      max: 0.995,
      description: '波の残り方。大きいほど長く残る。',
    },
    rippleStrength: {
      type: 'number',
      min: 0.1,
      max: 1.6,
      description: '触った時の波紋の強さ。',
    },
    rippleRadius: { type: 'number', min: 0.05, max: 0.5, description: '波紋の輪の太さ。' },
    swell: { type: 'number', min: 0, max: 4, description: '常時の水面のうねり。' },
    refract: { type: 'number', min: 0, max: 0.2, description: '水面越しの像の歪み。' },
    fresnel: { type: 'number', min: 0, max: 2, description: '水面反射の強さ。' },
    specular: { type: 'number', min: 0, max: 0.4, description: '月光の透過の明るさ。' },
    caustics: { type: 'number', min: 0, max: 4, description: '光の集束の強さ。' },
    ripple: { type: 'number', min: 0, max: 2.5, description: '波の輪の光り方。' },
    crestColor: { type: 'color', description: '波頭の色。#RRGGBB。' },
    lightBlend: {
      type: 'enum',
      values: [0, 1],
      description: '0=加算、1=スクリーン合成。',
    },
  },
  sky: {
    color: { type: 'color', description: '夜空の色。#RRGGBB。' },
  },
  scene: {
    windowLight: { type: 'number', min: 0, max: 1.5, description: '窓辺の光。' },
    colorFilter: {
      type: 'number',
      min: 0,
      max: 1,
      description: '最終カラーフィルターの強さ。',
    },
    filterColor: { type: 'color', description: 'カラーフィルター色。#RRGGBB。' },
  },
  clock: {
    show: { type: 'boolean', description: '時計を表示するか。' },
    seconds: { type: 'boolean', description: '秒を表示するか。' },
    moonName: { type: 'boolean', description: '月相の和名を表示するか。' },
    opacity: { type: 'number', min: 0.1, max: 1, description: '時計表示の濃さ。' },
  },
};

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function schemaFor(spec) {
  if (spec.type === 'color') {
    return {
      type: 'string',
      pattern: '^#[0-9A-Fa-f]{6}$',
      description: spec.description,
    };
  }
  if (spec.type === 'boolean') return { type: 'boolean', description: spec.description };
  if (spec.type === 'enum') {
    return {
      type: typeof spec.values[0] === 'number' ? 'number' : 'string',
      enum: spec.values,
      description: spec.description,
    };
  }
  return {
    type: spec.type === 'integer' ? 'integer' : 'number',
    minimum: spec.min,
    maximum: spec.max,
    description: spec.description,
  };
}

function configureInputSchema() {
  const properties = {};
  for (const [group, fields] of Object.entries(EXPOSED)) {
    properties[group] = {
      type: 'object',
      additionalProperties: false,
      properties: Object.fromEntries(
        Object.entries(fields).map(([name, spec]) => [name, schemaFor(spec)])
      ),
    };
  }
  return { type: 'object', additionalProperties: false, properties };
}

function normalizeValue(path, value, spec) {
  if (spec.type === 'color') {
    if (typeof value !== 'string' || !COLOR_RE.test(value)) {
      throw new TypeError(`${path} は #RRGGBB 形式で指定してください`);
    }
    return value.toLowerCase();
  }
  if (spec.type === 'boolean') {
    if (typeof value !== 'boolean') {
      throw new TypeError(`${path} は boolean で指定してください`);
    }
    return value;
  }
  if (spec.type === 'enum') {
    if (!spec.values.includes(value)) {
      throw new RangeError(`${path} は ${spec.values.join(', ')} のいずれかで指定してください`);
    }
    return value;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${path} は有限の数値で指定してください`);
  }
  if (spec.type === 'integer' && !Number.isInteger(value)) {
    throw new TypeError(`${path} は整数で指定してください`);
  }
  if (value < spec.min || value > spec.max) {
    throw new RangeError(`${path} は ${spec.min}〜${spec.max} の範囲で指定してください`);
  }
  return value;
}

export function validateScenePatch(patch) {
  if (!isPlainObject(patch)) throw new TypeError('設定はオブジェクトで指定してください');
  const changes = [];

  for (const [group, values] of Object.entries(patch)) {
    const fields = EXPOSED[group];
    if (!fields) throw new TypeError(`未知の設定グループです: ${group}`);
    if (!isPlainObject(values)) {
      throw new TypeError(`${group} はオブジェクトで指定してください`);
    }

    for (const [name, value] of Object.entries(values)) {
      const spec = fields[name];
      const path = `${group}.${name}`;
      if (!spec) throw new TypeError(`AIから変更できない設定です: ${path}`);
      changes.push({ path, value: normalizeValue(path, value, spec) });
    }
  }

  if (!changes.length) throw new TypeError('変更する設定を1つ以上指定してください');
  return changes;
}

function exposedState() {
  const out = {};
  for (const [group, fields] of Object.entries(EXPOSED)) {
    out[group] = {};
    for (const name of Object.keys(fields)) {
      out[group][name] = getPath(`${group}.${name}`);
    }
  }
  return out;
}

export function createWebMCPTools({ onSceneChange, onCalm } = {}) {
  const notify = () => onSceneChange?.();
  const presetIds = PRESETS.map((preset) => preset.id);

  return [
    {
      name: 'get_moon_keeper_state',
      title: '月飼いの現在設定を取得',
      description:
        '月飼いの現在の見た目・水面・星・時計設定と、利用できるプリセットを取得します。設定変更前の確認に使います。',
      inputSchema: { type: 'object', additionalProperties: false, properties: {} },
      annotations: {
        readOnlyHint: true,
        consequentialHint: false,
        untrustedContentHint: false,
      },
      execute: async () =>
        JSON.stringify({
          state: exposedState(),
          presets: PRESETS.map(({ id, label }) => ({ id, label })),
          shareUrl: shareUrl(),
        }),
    },
    {
      name: 'configure_moon_keeper_scene',
      title: '月飼いの景色を調整',
      description:
        '月・星・水面・夜空・窓辺の光・時計を調整します。「月を細くして星を減らす」「水面を静かにする」など、必要な項目だけ指定してください。変更は通常の設定UIと同じ状態へ保存されます。',
      inputSchema: configureInputSchema(),
      annotations: {
        readOnlyHint: false,
        consequentialHint: false,
        untrustedContentHint: false,
      },
      execute: async (input) => {
        const changes = validateScenePatch(input);
        for (const { path, value } of changes) setPath(path, value);
        applyState();
        notify();
        return JSON.stringify({
          ok: true,
          changed: changes.map(({ path, value }) => ({ path, value })),
        });
      },
    },
    {
      name: 'apply_moon_keeper_preset',
      title: '月飼いのプリセットを適用',
      description:
        '月飼いに用意されたプリセットを1つ適用します。個別調整より先に大きく雰囲気を変えたい時に使います。',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          preset: {
            type: 'string',
            enum: presetIds,
            description: '適用するプリセットID。',
          },
        },
        required: ['preset'],
      },
      annotations: {
        readOnlyHint: false,
        consequentialHint: false,
        untrustedContentHint: false,
      },
      execute: async ({ preset }) => {
        const item = PRESETS.find((candidate) => candidate.id === preset);
        if (!item) throw new RangeError(`未知のプリセットです: ${preset}`);
        applyPreset(preset);
        notify();
        return JSON.stringify({ ok: true, preset: item.id, label: item.label });
      },
    },
    {
      name: 'calm_moon_keeper_water',
      title: '月飼いの水面を凪がせる',
      description: '現在ある波紋を消して水面を凪がせます。水面設定そのものは変更しません。',
      inputSchema: { type: 'object', additionalProperties: false, properties: {} },
      annotations: {
        readOnlyHint: false,
        consequentialHint: false,
        untrustedContentHint: false,
      },
      execute: async () => {
        onCalm?.();
        return JSON.stringify({ ok: true });
      },
    },
  ];
}

export async function registerWebMCP(options = {}) {
  if (typeof document === 'undefined' || !document.modelContext?.registerTool) {
    return { supported: false, toolCount: 0 };
  }

  const tools = createWebMCPTools(options);
  const controller = new AbortController();

  try {
    for (const tool of tools) {
      await document.modelContext.registerTool(tool, { signal: controller.signal });
    }
  } catch (error) {
    // 一部だけ登録された状態を残さない。
    controller.abort();
    throw error;
  }

  return {
    supported: true,
    toolCount: tools.length,
    unregister: () => controller.abort(),
  };
}
