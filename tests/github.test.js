import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pollToken } from '../src/github.js';

// 응답을 차례대로 돌려주는 가짜 fetch
function mockFetch(responses) {
  globalThis.fetch = async () => ({ ok: true, json: async () => responses.shift() });
}

test('pending과 slow_down을 지나 토큰을 받는다', async () => {
  mockFetch([{ error: 'authorization_pending' }, { error: 'slow_down', interval: 10 }, { access_token: 'tok' }]);
  const waits = [];
  const token = await pollToken('dc', 5, { wait: async (ms) => waits.push(ms) });
  assert.equal(token, 'tok');
  assert.deepEqual(waits, [5000, 5000, 10000]);
});

test('만료되면 안내 메시지로 실패한다', async () => {
  mockFetch([{ error: 'expired_token' }]);
  await assert.rejects(pollToken('dc', 5, { wait: async () => {} }), /만료/);
});

test('알 수 없는 응답이면 멈추지 않고 실패한다', async () => {
  mockFetch([{}]);
  await assert.rejects(pollToken('dc', 5, { wait: async () => {} }), /실패/);
});
