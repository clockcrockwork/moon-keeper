import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { setTimeout as delay } from 'node:timers/promises';
import { state, resetState, applyState, shareUrl, loadState } from '../src/state.js';

// Node でブラウザのlocationとlocalStorageの最小インターフェースを再現する。
const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key),
};
globalThis.location = {
  origin: 'https://moon.example',
  pathname: '/',
  hash: '',
};

resetState();
state.location.mode = 'geolocation';
state.location.lat = 35.681234;
state.location.lon = 139.76789;
state.sky.color = '#123456';
applyState();

const shared = shareUrl();
assert.match(shared, /^https:\/\/moon\.example\/#s=/);
const payload = JSON.parse(Buffer.from(shared.split('#s=')[1], 'base64url').toString('utf8'));
assert.equal(Object.hasOwn(payload, 'location'), false, '共有URLに緯度・経度を含めない');
assert.equal(payload.sky.color, '#123456', '共有可能な表示設定は維持する');

await delay(500);
const local = JSON.parse(storage.get('moon-keeper.v1'));
assert.equal(local.location.lat, 35.681234, '端末内設定の保存は既存どおり維持する');

// 旧版で作った、緯度経度を含む共有URLも読み込む際に位置情報を採用しない。
storage.clear();
resetState();
state.location.mode = 'timezone';
state.location.lat = null;
state.location.lon = null;
const old = Buffer.from(JSON.stringify({
  location: { mode: 'geolocation', lat: 35.681234, lon: 139.76789 },
  moon: { color: '#abcdef' },
})).toString('base64url');
globalThis.location.hash = `#s=${old}`;
assert.equal(loadState(), 'url');
assert.equal(state.location.lat, null, '旧URLの正確な緯度を復元しない');
assert.equal(state.location.lon, null, '旧URLの正確な経度を復元しない');
assert.equal(state.moon.color, '#abcdef', '旧URLの表示設定は読み込める');
assert.equal(shareUrl().includes('location'), false);
console.log('share URL privacy checks passed');
