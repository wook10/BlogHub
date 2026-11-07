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

test('putFile: 없는 파일은 sha 없이 만들고, 있는 파일은 sha를 넣어 덮어쓴다', async () => {
  const { putFile } = await import('../src/github.js');
  const calls = [];
  const run = async (getStatus) => {
    calls.length = 0;
    globalThis.fetch = async (url, init) => {
      calls.push(init);
      const status = init.method === 'GET' ? getStatus : 200;
      return { ok: status < 300, status, json: async () => (status === 200 ? { sha: 'abc' } : {}) };
    };
    return putFile('t', 'me/repo', 'posts/한글.md', '본문', (exists) => (exists ? '수정' : '새 글'));
  };

  assert.equal(await run(404), false);
  const created = JSON.parse(calls[1].body);
  assert.equal(created.sha, undefined);
  assert.equal(created.message, '새 글');
  assert.equal(Buffer.from(created.content, 'base64').toString(), '본문');

  assert.equal(await run(200), true);
  assert.equal(JSON.parse(calls[1].body).sha, 'abc');

  await assert.rejects(run(500)); // 404가 아닌 오류는 덮어쓰지 않고 실패
});
