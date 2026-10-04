import assert from 'node:assert/strict';

import { createWebMCPTools, registerWebMCP, validateScenePatch } from '../src/webmcp.js';
import { getPath, resetState } from '../src/state.js';

globalThis.location = { origin: 'https://example.test', pathname: '/' };

const changes = validateScenePatch({
  moon: { intensity: 1.4, color: '#ABCDEF' },
  stars: { count: 40 },
  water: { swell: 0.25 },
});

assert.deepEqual(changes, [
  { path: 'moon.intensity', value: 1.4 },
  { path: 'moon.color', value: '#abcdef' },
  { path: 'stars.count', value: 40 },
  { path: 'water.swell', value: 0.25 },
]);

assert.throws(() => validateScenePatch({ water: { swell: 99 } }), /0〜4/);
assert.throws(() => validateScenePatch({ stars: { count: 1.5 } }), /整数/);
assert.throws(() => validateScenePatch({ moon: { color: 'white' } }), /#RRGGBB/);
assert.throws(
  () => validateScenePatch({ location: { mode: 'manual' } }),
  /未知の設定グループ/
);
assert.throws(
  () => validateScenePatch({ scene: { quality: 'low' } }),
  /AIから変更できない設定/
);
assert.throws(() => validateScenePatch({}), /1つ以上/);
// プロトタイプ上のキーを既知の設定として通さない（JSON 由来の own __proto__ も含む）
assert.throws(
  () => validateScenePatch(JSON.parse('{"__proto__":{"hasOwnProperty":0.5}}')),
  /未知の設定グループ/
);
assert.throws(() => validateScenePatch({ constructor: { name: 1 } }), /未知の設定グループ/);
assert.throws(() => validateScenePatch({ moon: { constructor: 1 } }), /AIから変更できない設定/);
assert.throws(() => validateScenePatch({ moon: { toString: 1 } }), /AIから変更できない設定/);
assert.equal(typeof Object.prototype.hasOwnProperty, 'function');

let calmCount = 0;
let refreshCount = 0;
const webmcpTools = createWebMCPTools({
  onCalm: () => calmCount++,
  onSceneChange: () => refreshCount++,
});
const byName = new Map(webmcpTools.map((tool) => [tool.name, tool]));

assert.deepEqual([...byName.keys()], [
  'get_moon_keeper_state',
  'configure_moon_keeper_scene',
  'apply_moon_keeper_preset',
  'calm_moon_keeper_water',
]);

await byName.get('configure_moon_keeper_scene').execute({
  moon: { phaseMode: 'manual', phaseManual: 0.1 },
  water: { swell: 0.2 },
});

assert.equal(getPath('moon.phaseMode'), 'manual');
assert.equal(getPath('moon.phaseManual'), 0.1);
assert.equal(getPath('water.swell'), 0.2);
assert.equal(refreshCount, 1);

await byName.get('calm_moon_keeper_water').execute({});
assert.equal(calmCount, 1);

const stateResult = JSON.parse(
  await byName.get('get_moon_keeper_state').execute({})
);
assert.equal(stateResult.state.moon.phaseManual, 0.1);
assert.match(stateResult.shareUrl, /^https:\/\/example\.test\//);

await byName.get('apply_moon_keeper_preset').execute({ preset: 'amber' });
assert.equal(getPath('moon.intensity'), 1.15);
assert.equal(refreshCount, 2);

const registered = [];
globalThis.document = {
  modelContext: {
    registerTool: async (tool, options) => {
      registered.push({ name: tool.name, signal: options?.signal });
    },
  },
};

const registration = await registerWebMCP();
assert.equal(registration.supported, true);
assert.equal(registration.toolCount, 4);
assert.equal(registered.length, 4);
assert.ok(registered.every(({ signal }) => signal instanceof AbortSignal && !signal.aborted));

registration.unregister();
assert.ok(registered.every(({ signal }) => signal.aborted));
delete globalThis.document;

resetState();
console.log('WebMCP checks passed');
