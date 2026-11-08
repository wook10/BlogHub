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

test('commitFiles: 글·이미지·삭제를 커밋 하나로 묶는다', async () => {
  const { commitFiles } = await import('../src/github.js');
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const path = url.replace('https://api.github.com/repos/me/r', '');
    calls.push({ method: init.method ?? 'GET', path, body: init.body && JSON.parse(init.body) });
    const res = {
      '': { default_branch: 'main' },
      '/git/ref/heads/main': { object: { sha: 'head' } },
      '/git/commits/head': { tree: { sha: 'base' } },
      '/git/trees/base?recursive=1': {
        tree: [{ path: 'posts/old.md', type: 'blob' }, { path: 'posts/images/a/9.png', type: 'blob' }, { path: 'posts/images/a/1.png', type: 'blob' }],
      },
      '/git/blobs': { sha: 'img' },
      '/git/trees': { sha: 'newtree' },
      '/git/commits': { sha: 'newcommit' },
      '/git/refs/heads/main': {},
    }[path];
    return { ok: true, status: 200, json: async () => res };
  };

  const has = await commitFiles('t', 'me/r', {
    files: { 'posts/a.md': '본문', 'posts/images/a/1.png': new Uint8Array([1, 2]), 'posts/old.md': null, 'posts/none.md': null },
    deleteDirs: ['posts/images/a'],
    message: (has) => (has.has('posts/a.md') ? '수정' : '새 글'),
  });

  assert.ok(has.has('posts/old.md'));
  assert.equal(calls.find((c) => c.path === '/git/blobs').body.content, 'AQI=');
  assert.deepEqual(calls.find((c) => c.path === '/git/trees').body.tree, [
    { path: 'posts/a.md', mode: '100644', type: 'blob', content: '본문' },
    { path: 'posts/images/a/1.png', mode: '100644', type: 'blob', sha: 'img' },
    { path: 'posts/old.md', mode: '100644', type: 'blob', sha: null },
    // posts/none.md는 원래 없으니 지우지 않고, 글에서 빠진 9.png는 지운다
    { path: 'posts/images/a/9.png', mode: '100644', type: 'blob', sha: null },
  ]);
  assert.deepEqual(calls.find((c) => c.path === '/git/commits' && c.method === 'POST').body, {
    message: '새 글', tree: 'newtree', parents: ['head'],
  });
  assert.deepEqual(calls.at(-1), { method: 'PATCH', path: '/git/refs/heads/main', body: { sha: 'newcommit' } });
});

test('commitFiles: 바뀐 게 없으면 커밋하지 않는다', async () => {
  const { commitFiles } = await import('../src/github.js');
  const methods = [];
  globalThis.fetch = async (url, init) => {
    methods.push(init.method ?? 'GET');
    const path = url.replace('https://api.github.com/repos/me/r', '');
    const res = path === '' ? { default_branch: 'main' } : path.startsWith('/git/ref/') ? { object: { sha: 'h' } }
      : path === '/git/commits/h' ? { tree: { sha: 'same' } } : path.includes('recursive') ? { tree: [] } : { sha: 'same' };
    return { ok: true, status: 200, json: async () => res };
  };
  await commitFiles('t', 'me/r', { files: { 'posts/a.md': 'x' }, message: 'm' });
  assert.deepEqual(methods, ['GET', 'GET', 'GET', 'GET', 'GET', 'POST']); // 트리만 만들어 보고 커밋·ref 변경 없음
});

// GitHub 응답을 경로별로 흉내 내는 가짜 fetch. handler가 undefined를 돌려주면 기본 응답을 쓴다.
function fakeGitHub(handler = () => undefined) {
  const calls = [];
  let head = 'h1';
  globalThis.fetch = async (url, init) => {
    const method = init.method ?? 'GET';
    const path = url.replace('https://api.github.com/repos/me/r', '');
    const body = init.body && JSON.parse(init.body);
    calls.push({ method, path, body });
    const custom = handler(method, path, body, calls);
    if (custom) return custom;
    const ok = (data) => ({ ok: true, status: 200, json: async () => data });
    if (path === '') return ok({ default_branch: 'main' });
    if (path === '/git/ref/heads/main') return ok({ object: { sha: head } });
    if (path.startsWith('/git/commits/')) return ok({ tree: { sha: `tree-${path.split('/').pop()}` } });
    if (path.includes('recursive')) return ok({ tree: [] });
    if (path === '/git/trees') return ok({ sha: 'newtree' });
    if (path === '/git/commits') return ok({ sha: 'c' });
    return ok({});
  };
  return { calls, moveHead: (sha) => (head = sha) };
}

test('commitFiles: 그사이 다른 커밋이 끼어들면 최신 커밋 위에서 다시 한다', async () => {
  const { commitFiles } = await import('../src/github.js');
  let patches = 0;
  const gh = fakeGitHub((method, path) => {
    if (method === 'PATCH' && ++patches === 1) {
      gh.moveHead('h2'); // 다른 출간이 먼저 커밋됨
      return { ok: false, status: 422, json: async () => ({ message: 'Update is not a fast forward' }) };
    }
  });
  await commitFiles('t', 'me/r', { files: { 'posts/a.md': 'x' }, message: 'm' });
  const commits = gh.calls.filter((c) => c.path === '/git/commits' && c.method === 'POST');
  assert.deepEqual(commits.map((c) => c.body.parents), [['h1'], ['h2']]);
  assert.equal(patches, 2);
});

test('commitFiles: 빈 저장소면 README로 첫 커밋을 만들고 이어서 커밋한다', async () => {
  const { commitFiles } = await import('../src/github.js');
  let empty = true;
  const gh = fakeGitHub((method, path) => {
    if (path === '/contents/README.md') {
      empty = false;
      return { ok: true, status: 201, json: async () => ({}) };
    }
    if (path === '/git/ref/heads/main' && empty) return { ok: false, status: 409, json: async () => ({ message: 'Git Repository is empty.' }) };
  });
  await commitFiles('t', 'me/r', { files: { 'posts/a.md': 'x' }, message: 'm' });
  assert.ok(gh.calls.some((c) => c.method === 'PUT' && c.path === '/contents/README.md'));
  assert.equal(gh.calls.at(-1).method, 'PATCH');
});
