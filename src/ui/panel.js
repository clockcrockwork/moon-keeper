import {
  state,
  applyState,
  applyPreset,
  resetState,
  shareUrl,
  getPath,
  setPath,
  PRESETS,
} from '../state.js';
import { requestGeolocation, locationFromTimezone } from '../astro/location.js';

// 操作パネル。
//
// 今の世界観（明朝体の薄い文字が消えていく、ほぼ黒の画面）を壊さないこと。
// 普段は画面端の細いタブだけがほのかに光り、触ると磨りガラスの板が出てくる。
// 3秒放っておくと自分で引っ込む。

const AUTO_HIDE_MS = 3200;

// 項目をデータで持って描画は一箇所にまとめる。増やすのはこの表だけで済む。
const SCHEMA = [
  {
    title: '月',
    items: [
      { path: 'moon.color', label: '月明かりの色', type: 'color' },
      { path: 'moon.intensity', label: '明るさ', type: 'range', min: 0, max: 2, step: 0.01 },
      { path: 'moon.size', label: '大きさ', type: 'range', min: 0.05, max: 0.45, step: 0.005 },
      { path: 'moon.depth', label: '深さ', type: 'range', min: 1.5, max: 9, step: 0.1 },
      { path: 'moon.glow', label: '水中の散乱', type: 'range', min: 0, max: 0.4, step: 0.005 },
      { path: 'moon.halo', label: '月縁のハロー', type: 'range', min: 0, max: 0.4, step: 0.005 },
      { path: 'moon.earthshine', label: '地球照', type: 'range', min: 0, max: 0.25, step: 0.005 },
      { path: 'moon.driftAmount', label: '漂い', type: 'range', min: 0, max: 0.6, step: 0.01 },
      {
        path: 'moon.phaseMode',
        label: '月相',
        type: 'choice',
        choices: [
          ['auto', '今夜'],
          ['manual', '手動'],
        ],
      },
      {
        path: 'moon.phaseManual',
        label: '満ち欠け',
        type: 'range',
        min: 0,
        max: 1,
        step: 0.002,
        // 手動モードの時だけ出す
        visible: () => state.moon.phaseMode === 'manual',
      },
    ],
  },
  {
    title: '星',
    items: [
      { path: 'stars.color', label: '星の色', type: 'color' },
      { path: 'stars.count', label: '数', type: 'range', min: 0, max: 900, step: 10 },
      { path: 'stars.brightness', label: '明るさ', type: 'range', min: 0, max: 2.5, step: 0.02 },
      { path: 'stars.twinkle', label: '瞬き', type: 'range', min: 0, max: 3, step: 0.02 },
      { path: 'stars.milkyWay', label: '天の川', type: 'range', min: 0, max: 1, step: 0.01 },
      { path: 'stars.shootingStars', label: '流れ星', type: 'toggle' },
    ],
  },
  {
    title: '水',
    items: [
      { path: 'water.crestColor', label: '波頭の色', type: 'color' },
      { path: 'water.swell', label: 'うねり', type: 'range', min: 0, max: 4, step: 0.02 },
      { path: 'water.damping', label: '波の残り', type: 'range', min: 0.93, max: 0.995, step: 0.001 },
      { path: 'water.rippleStrength', label: '波紋の強さ', type: 'range', min: 0.1, max: 1.6, step: 0.02 },
      { path: 'water.refract', label: '歪み', type: 'range', min: 0, max: 0.2, step: 0.002 },
      { path: 'water.fresnel', label: '反射', type: 'range', min: 0, max: 2, step: 0.02 },
      { path: 'water.specular', label: '月の透過', type: 'range', min: 0, max: 0.4, step: 0.005 },
      { path: 'water.caustics', label: '光の集束', type: 'range', min: 0, max: 4, step: 0.05 },
    ],
  },
  {
    title: '空と時計',
    items: [
      { path: 'sky.color', label: '夜空の色', type: 'color' },
      { path: 'scene.windowLight', label: '窓辺の光', type: 'range', min: 0, max: 1.5, step: 0.02 },
      { path: 'clock.show', label: '時計', type: 'toggle' },
      { path: 'clock.seconds', label: '秒も出す', type: 'toggle', visible: () => state.clock.show },
      { path: 'clock.moonName', label: '月の和名', type: 'toggle', visible: () => state.clock.show },
      {
        path: 'clock.opacity',
        label: '濃さ',
        type: 'range',
        min: 0.1,
        max: 1,
        step: 0.02,
        visible: () => state.clock.show,
      },
    ],
  },
  {
    title: '場所と品質',
    items: [
      { type: 'location' },
      {
        path: 'scene.quality',
        label: '品質',
        type: 'choice',
        choices: [
          ['auto', '自動'],
          ['high', '高'],
          ['mid', '中'],
          ['low', '低'],
        ],
      },
    ],
  },
];

export function createPanel({ onQualityChange, onPhaseInfo } = {}) {
  const root = document.getElementById('panel');
  const tab = document.getElementById('panel-tab');
  const body = document.getElementById('panel-body');
  if (!root || !tab || !body) return { refresh() {} };

  // URL に #panel=open を付けると、開いたまま自動退避しなくなる。
  // スクリーンショットや調整作業のための逃げ道。
  const pinned = /(?:^|[#&])panel=open(?:&|$)/.test(location.hash);

  let open = false;
  let hideTimer = 0;
  const refreshers = [];

  function scheduleHide() {
    if (pinned) return;
    clearTimeout(hideTimer);
    if (open) hideTimer = setTimeout(close, AUTO_HIDE_MS);
  }

  function openPanel() {
    open = true;
    root.classList.add('open');
    tab.setAttribute('aria-expanded', 'true');
    refresh();
    scheduleHide();
  }

  function close() {
    if (pinned) return;
    open = false;
    root.classList.remove('open');
    tab.setAttribute('aria-expanded', 'false');
    clearTimeout(hideTimer);
  }

  function commit() {
    applyState();
    refresh();
    scheduleHide();
  }

  // ---- 部品 ----

  function labelled(label, control) {
    const row = document.createElement('label');
    row.className = 'row';
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = label;
    row.append(name, control);
    return row;
  }

  function buildRange(item) {
    const input = document.createElement('input');
    input.type = 'range';
    input.min = item.min;
    input.max = item.max;
    input.step = item.step;
    const readout = document.createElement('span');
    readout.className = 'value';

    const sync = () => {
      const v = Number(getPath(item.path));
      input.value = String(v);
      readout.textContent = item.step >= 1 ? String(Math.round(v)) : v.toFixed(3);
    };
    input.addEventListener('input', () => {
      setPath(item.path, Number(input.value));
      commit();
    });

    const wrap = document.createElement('span');
    wrap.className = 'control';
    wrap.append(input, readout);
    refreshers.push(sync);
    sync();
    return labelled(item.label, wrap);
  }

  function buildColor(item) {
    const input = document.createElement('input');
    input.type = 'color';
    const sync = () => {
      input.value = String(getPath(item.path));
    };
    input.addEventListener('input', () => {
      setPath(item.path, input.value);
      commit();
    });
    refreshers.push(sync);
    sync();
    const wrap = document.createElement('span');
    wrap.className = 'control';
    wrap.append(input);
    return labelled(item.label, wrap);
  }

  function buildToggle(item) {
    const input = document.createElement('input');
    input.type = 'checkbox';
    const sync = () => {
      input.checked = Boolean(getPath(item.path));
    };
    input.addEventListener('change', () => {
      setPath(item.path, input.checked);
      commit();
    });
    refreshers.push(sync);
    sync();
    const wrap = document.createElement('span');
    wrap.className = 'control';
    wrap.append(input);
    return labelled(item.label, wrap);
  }

  function buildChoice(item) {
    const wrap = document.createElement('span');
    wrap.className = 'control choices';
    const buttons = item.choices.map(([value, text]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = text;
      b.addEventListener('click', () => {
        setPath(item.path, value);
        if (item.path === 'scene.quality') onQualityChange?.(value);
        commit();
      });
      wrap.append(b);
      return [value, b];
    });
    const sync = () => {
      const current = getPath(item.path);
      for (const [value, b] of buttons) b.classList.toggle('on', value === current);
    };
    refreshers.push(sync);
    sync();
    return labelled(item.label, wrap);
  }

  function buildLocation() {
    const block = document.createElement('div');
    block.className = 'block';

    const status = document.createElement('div');
    status.className = 'note';

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'wide';
    button.textContent = '現在地を使う';
    button.addEventListener('click', async () => {
      button.disabled = true;
      button.textContent = '確認中…';
      const result = await requestGeolocation();
      state.location.lat = result.lat;
      state.location.lon = result.lon;
      state.location.mode = result.source === 'geolocation' ? 'geolocation' : 'timezone';
      button.disabled = false;
      button.textContent = '現在地を使う';
      commit();
    });

    const sync = () => {
      const loc =
        state.location.lat === null
          ? locationFromTimezone()
          : { lat: state.location.lat, lon: state.location.lon, source: state.location.mode };
      const how =
        loc.source === 'geolocation'
          ? '位置情報'
          : loc.source === 'manual'
            ? '手入力'
            : 'タイムゾーンから推定';
      status.textContent =
        `${loc.lat.toFixed(1)}°, ${loc.lon.toFixed(1)}°（${how}）\n` +
        '月の欠け具合は世界共通。位置は「欠けの傾き」だけに効きます。';
    };
    refreshers.push(sync);
    sync();

    block.append(button, status);
    return block;
  }

  // ---- 組み立て ----

  function build() {
    body.textContent = '';
    refreshers.length = 0;

    // プリセット（「楽しくてクール」の実体。最上段に置く）
    const presetRow = document.createElement('div');
    presetRow.className = 'presets';
    for (const preset of PRESETS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = preset.label;
      b.style.setProperty('--swatch', preset.patch.moon.color);
      b.addEventListener('click', () => {
        applyPreset(preset.id);
        refresh();
        scheduleHide();
      });
      presetRow.append(b);
    }
    body.append(presetRow);

    // 月相の表示（今夜の月が何なのか分かるように）
    const phaseNote = document.createElement('div');
    phaseNote.className = 'phase-note';
    body.append(phaseNote);
    refreshers.push(() => {
      const info = onPhaseInfo?.();
      phaseNote.textContent = info
        ? `${info.name}・月齢 ${info.age.toFixed(1)}・輝面比 ${(info.illuminatedFraction * 100).toFixed(0)}%`
        : '';
    });

    for (const group of SCHEMA) {
      const details = document.createElement('details');
      const summary = document.createElement('summary');
      summary.textContent = group.title;
      details.append(summary);

      for (const item of group.items) {
        let node = null;
        if (item.type === 'range') node = buildRange(item);
        else if (item.type === 'color') node = buildColor(item);
        else if (item.type === 'toggle') node = buildToggle(item);
        else if (item.type === 'choice') node = buildChoice(item);
        else if (item.type === 'location') node = buildLocation();
        if (!node) continue;

        if (item.visible) {
          refreshers.push(() => {
            node.style.display = item.visible() ? '' : 'none';
          });
        }
        details.append(node);
      }
      body.append(details);
    }

    // 共有とリセット
    const actions = document.createElement('div');
    actions.className = 'actions';

    const share = document.createElement('button');
    share.type = 'button';
    share.textContent = 'この月のURLをコピー';
    share.addEventListener('click', async () => {
      const url = shareUrl();
      try {
        await navigator.clipboard.writeText(url);
        share.textContent = 'コピーしました';
      } catch {
        // クリップボードが使えない場合はハッシュだけ反映して見せる
        location.hash = new URL(url).hash;
        share.textContent = 'URLに反映しました';
      }
      setTimeout(() => {
        share.textContent = 'この月のURLをコピー';
      }, 1800);
      scheduleHide();
    });

    const reset = document.createElement('button');
    reset.type = 'button';
    reset.textContent = '既定に戻す';
    reset.addEventListener('click', () => {
      resetState();
      onQualityChange?.(state.scene.quality);
      refresh();
      scheduleHide();
    });

    actions.append(share, reset);
    body.append(actions);
  }

  function refresh() {
    for (const fn of refreshers) fn();
  }

  build();

  if (pinned) openPanel();

  tab.addEventListener('click', () => (open ? close() : openPanel()));
  // パネルの上での操作では自動退避のタイマーを延ばす
  root.addEventListener('pointerdown', scheduleHide);
  root.addEventListener('pointermove', () => {
    if (open) scheduleHide();
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });

  return { refresh, open: openPanel, close };
}
