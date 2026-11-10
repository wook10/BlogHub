// 서비스 워커(background.js)의 말투·비공개 글 처리를 가짜 chrome·GitHub·velog·Gemini로 확인한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const POPUP = { url: 'chrome-extension://test/popup/popup.html' };
const BLOG = { url: 'https://velog.io/@me' };
const data = { anthropicKey: 'old-claude-key', toneProfile: { text: '예전 분석', time: 1 } }; // 예전 버전이 남긴 것
let listener;
globalThis.chrome = {
  storage: {
    local: {
      get: async (k) => (k == null ? structuredClone(data) : Object.fromEntries([k].flat().filter((x) => x in data).map((x) => [x, structuredClone(data[x])]))),
      set: async (o) => Object.assign(data, structuredClone(o)),
      remove: async (k) => [k].flat().forEach((x) => delete data[x]),
    },
    onChanged: { addListener() {} },
  },
  runtime: { onMessage: { addListener: (fn) => (listener = fn) }, getURL: (p) => `chrome-extension://test/${p}`, getPlatformInfo: async () => ({}), getContexts: async () => [] },
};
console.error = () => {}; // 실패 기록은 일부러 일으키는 것이라 소리를 줄인다

const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
const velogPost = (id, priv) => ({ id, title: `글 ${id}`, body: `본문 ${id}입니다.`, tags: [], is_private: priv, is_temp: false, url_slug: `s-${id}`, released_at: '2026-11-01T00:00:00Z', series: null, user: { username: 'me' } });
const world = { posts: [], repos: [], tree: [], gemini: [], trees: [], commits: [] };
const reset = (over = {}) => {
  for (const k of Object.keys(data)) delete data[k];
  Object.assign(data, { token: 't', user: 'me', repo: 'me/blog', folders: { 'me/blog': 'posts' }, tone: 'first', geminiKey: 'AIzaFAKE', savePrivate: true }, over);
  Object.assign(world, { posts: [], repos: [], tree: [], gemini: [], trees: [], commits: [] });
};
globalThis.fetch = async (url, init) => {
  url = String(url);
  if (url.includes('generativelanguage')) {
    const input = JSON.parse(init.body).contents[0].parts[0].text;
    world.gemini.push(input);
    return json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: `${input} (바뀜)` }] } }] });
  }
  if (url.includes('v2.velog.io')) {
    const { query, variables } = JSON.parse(init.body);
    if (query.includes('post(id')) return json({ data: { post: world.posts.find((p) => p.id === variables.id) ?? null } });
    return json({ data: { posts: variables.cursor ? [] : world.posts } });
  }
  if (url.startsWith('https://api.github.com/user/repos')) return json(world.repos);
  if (/api\.github\.com\/repos\/me\/blog$/.test(url)) return json({ default_branch: 'main' });
  if (/git\/ref\/heads\/main/.test(url)) return json({ object: { sha: 'h1' } });
  if (/git\/commits\/h1$/.test(url)) return json({ tree: { sha: 't1' } });
  if (/\/git\/trees\/(HEAD|t1)\?recursive=1/.test(url)) return json({ truncated: false, tree: world.tree.map((path) => ({ type: 'blob', path, sha: `s-${path}` })) });
  if (/\/git\/trees$/.test(url)) { world.trees.push(JSON.parse(init.body).tree); return json({ sha: 't2' }); }
  if (/\/git\/commits$/.test(url)) { world.commits.push(JSON.parse(init.body).message); return json({ sha: 'c2' }); }
  if (/git\/refs\/heads\/main/.test(url)) return json({});
  if (/git\/blobs\//.test(url)) return json({ content: Buffer.from('# 글\n' + '오늘은 리액트의 상태 관리를 정리했다. '.repeat(20)).toString('base64') });
  if (/api\.github\.com\/repos\/(me\/[\w-]+)\/git\/trees\/HEAD/.test(url)) return json({ truncated: false, tree: [] });
  throw new Error(`예상 못한 요청: ${url}`);
};

await import('../src/background.js');
const send = (msg, sender = POPUP) => new Promise((resolve) => listener(msg, sender, resolve));
const settle = async () => { for (let i = 0; i < 100 && data.importStatus; i++) await new Promise((r) => setTimeout(r, 50)); };

test('시작할 때 예전 버전이 남긴 Claude 키와 옛 판의 말투 분석을 지운다', async () => {
  await new Promise((r) => setTimeout(r, 100));
  assert.ok(!('anthropicKey' in data));
  assert.ok(!('toneProfile' in data));
});

test('가져오기: 비공개 글은 AI에 보내지 않고 이유를 알린다', async () => {
  reset();
  world.posts = [velogPost('p1', true)];
  await send({ type: 'importOne', blog: 'velog', username: 'me', id: 'p1' });
  assert.equal(world.gemini.length, 0);
  assert.match(data.lastSync.message, /비공개 글은 AI에 보내지 않아/);
});

test('말투를 바꿔 둔 글이 비공개가 되면: 저장하지 않고 저장소의 예전 글은 그대로 둔다 (비공개 저장 켬)', async () => {
  reset({ paths: { 'me/blog': { p1: 'posts/old.md' } }, tones: { 'me/blog': { p1: 'first' } } });
  world.posts = [velogPost('p1', true)];
  world.tree = ['posts/old.md'];
  await send({ type: 'publish', id: 'p1' }, BLOG);
  assert.equal(world.gemini.length, 0);
  assert.match(data.lastSync.message, /예전 글은 그대로예요/);
  assert.equal(world.trees.length, 0); // 저장소를 건드리지 않았다
  assert.equal(data.paths['me/blog'].p1, 'posts/old.md');
});

test('비공개 저장을 끄면 비공개가 된 글은 저장소에서도 지우고 말투 기록도 지운다 (원래 규칙)', async () => {
  reset({ savePrivate: false, paths: { 'me/blog': { p1: 'posts/old.md' } }, tones: { 'me/blog': { p1: 'first' } } });
  world.posts = [velogPost('p1', true)];
  world.tree = ['posts/old.md'];
  await send({ type: 'publish', id: 'p1' }, BLOG);
  assert.ok(world.trees.flat().some((e) => e.path === 'posts/old.md' && e.sha === null), '글 파일 삭제');
  assert.ok(!('p1' in data.paths['me/blog']) && !('p1' in data.tones['me/blog']));
});

test('내 말투 분석: 공개 저장소만 읽고, 블로그 페이지가 보낸 요청은 거절한다', async () => {
  reset({ tone: 'original' });
  world.repos = [
    { full_name: 'me/public-til', name: 'public-til', private: false, fork: false },
    { full_name: 'me/secret-notes', name: 'secret-notes', private: true, fork: false },
    { full_name: 'me/forked', name: 'forked', private: false, fork: true },
  ];
  world.tree = ['til/a.md'];
  const seen = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const m = String(url).match(/repos\/(me\/[\w-]+)\/git\/trees\/HEAD/);
    if (m) seen.push(m[1]);
    return real(url, init);
  };
  // 저장소 이름마다 가짜 응답이 필요해서 me/blog 말고도 받아 준다
  const ok = await send({ type: 'analyzeTone' });
  globalThis.fetch = real;
  assert.ok(ok.ok, ok.error);
  assert.deepEqual([...new Set(seen)], ['me/public-til']); // 비공개 저장소와 포크는 읽지 않는다
  const denied = await send({ type: 'analyzeTone' }, BLOG);
  assert.match(denied.error, /팝업에서만/);
});

test('한 번에 모두: 비공개 글은 따로 세고 AI에는 공개 글만, 다시 해도 이미 저장된 글은 건너뛴다', async () => {
  reset();
  world.posts = [velogPost('a', false), velogPost('b', true)];
  await send({ type: 'import', blog: 'velog', username: 'me' });
  await settle();
  assert.equal(world.gemini.length, 1);
  assert.match(data.lastSync.message, /1개를 GitHub에 저장/);
  assert.match(data.lastSync.message, /비공개 글 1개는 AI에 보내지 않아 건너뜀/);
  assert.doesNotMatch(data.lastSync.message, /못 읽은/);
  assert.equal(data.tones['me/blog'].a, 'first'); // 나중에 고쳐도 같은 말투로

  // 다시: 저장소에 이미 있으니 AI를 다시 부르지 않는다
  world.tree = [data.paths['me/blog'].a];
  world.gemini.length = 0;
  await send({ type: 'import', blog: 'velog', username: 'me' });
  await settle();
  assert.equal(world.gemini.length, 0);
  assert.match(data.lastSync.message, /이미 저장된 글 1개는 건너뜀/);
});

test('한 번에 모두: 키가 없으면 바로 멈추고 안내한다', async () => {
  reset({ geminiKey: undefined });
  delete data.geminiKey;
  world.posts = [velogPost('a', false)];
  await send({ type: 'import', blog: 'velog', username: 'me' });
  await settle();
  assert.equal(data.lastSync.ok, false);
  assert.match(data.lastSync.message, /Gemini API 키/);
  assert.equal(world.gemini.length, 0);
});
