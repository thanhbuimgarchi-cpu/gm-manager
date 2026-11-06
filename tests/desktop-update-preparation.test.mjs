import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const { createUpdatePreparation } = require('../desktop/update-preparation.cjs');

function fixture(timeoutMs = 100) {
  const sent = [];
  const contents = { send: (...args) => sent.push(args), isDestroyed: () => false };
  const window = { isDestroyed: () => false, webContents: contents };
  const preparation = createUpdatePreparation({ getWindow: () => window, timeoutMs, requestId: () => 'qa-one-use-request' });
  return { preparation, contents, window, sent };
}

test('installation preparation waits for the current renderer and rejects stale or foreign acknowledgements', async () => {
  const f = fixture();
  const first = f.preparation.prepare(), second = f.preparation.prepare();
  assert.equal(first, second);
  assert.deepEqual(f.sent, [['gmcrm:prepare-update', 'qa-one-use-request']]);
  assert.equal(f.preparation.acknowledge({}, { requestId: 'qa-one-use-request', ok: true }), false);
  assert.equal(f.preparation.acknowledge(f.contents, { requestId: 'old-request', ok: true }), false);
  assert.equal(f.preparation.acknowledge(f.contents, { requestId: 'qa-one-use-request', ok: 'true' }), false);
  assert.equal(f.preparation.acknowledge(f.contents, { requestId: 'qa-one-use-request', ok: true }), true);
  await first;
  assert.equal(f.preparation.acknowledge(f.contents, { requestId: 'qa-one-use-request', ok: true }), false, 'acknowledgements are consumed exactly once');
});

test('unsaved work, missing listeners and destroyed windows prevent installer handoff', async () => {
  const f = fixture();
  const failed = f.preparation.prepare();
  const rejection = assert.rejects(failed, /Bản nháp chưa lưu/);
  f.preparation.acknowledge(f.contents, { requestId: 'qa-one-use-request', ok: false, error: 'Bản nháp chưa lưu' });
  await rejection;
  const timeout = fixture(10);
  await assert.rejects(timeout.preparation.prepare(), /chưa xác nhận lưu dữ liệu/);
  const retry = timeout.preparation.prepare();
  timeout.preparation.acknowledge(timeout.contents, { requestId: 'qa-one-use-request', ok: true });
  await retry;
  f.window.isDestroyed = () => true;
  await assert.rejects(f.preparation.prepare(), /mở lại GM Manager/);
});

test('preload preparation runs the latest subscriber and only acknowledges success after saving', async () => {
  const ipc = new EventEmitter(), calls = [];
  ipc.invoke = async (...args) => { calls.push(args); return true; };
  let bridge;
  vm.runInNewContext(await readFile(new URL('../desktop/preload.cjs', import.meta.url), 'utf8'), {
    process: { platform: 'win32' },
    require: () => ({ ipcRenderer: ipc, contextBridge: { exposeInMainWorld: (_name, api) => { bridge = api; } } }),
  });
  let complete;
  const unsubscribe = bridge.onBeforeUpdate(() => new Promise(resolve => { complete = resolve; }));
  ipc.emit('gmcrm:prepare-update', {}, 'qa-save');
  assert.equal(calls.length, 0);
  complete();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [['gmcrm:update-prepared', { requestId: 'qa-save', ok: true }]]);
  unsubscribe();
  const stop = bridge.onBeforeUpdate(async () => { throw new Error('Không lưu được bản nháp'); });
  ipc.emit('gmcrm:prepare-update', {}, 'qa-block');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.at(-1)[1].ok, false);
  assert.equal(calls.at(-1)[1].error, 'Không lưu được bản nháp');
  stop();
  assert.equal(ipc.listenerCount('gmcrm:prepare-update'), 0);
  const states = [], detach = bridge.onUpdateProgress(state => states.push(state));
  ipc.emit('gmcrm:update-progress', {}, { phase: 'downloading', percent: 25 });
  assert.equal(states[0].percent, 25);
  detach();
  assert.equal(ipc.listenerCount('gmcrm:update-progress'), 0);
});
