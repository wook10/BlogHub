import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalize, fetchPost } from '../src/velog.js';

const raw = {
  id: 'p1',
  title: '제목',
  body: null,
  tags: null,
  is_private: false,
  is_temp: false,
  url_slug: 'slug',
  released_at: '2026-11-08T00:00:00Z',
  series: { name: '시리즈' },
  user: { username: 'me' },
};

test('normalize: 비어 있어도 되는 값은 채우고, 꼭 필요한 값이 없으면 오류', () => {
  const post = normalize(raw);
  assert.equal(post.body, '');
  assert.deepEqual(post.tags, []);
  assert.equal(post.series, '시리즈');
  assert.equal(post.username, 'me');
  assert.throws(() => normalize({ ...raw, released_at: null }));
  assert.throws(() => normalize({ ...raw, user: null }));
});

test('fetchPost: 지워진 글은 null, 서버 오류는 알아보기 쉬운 메시지', async () => {
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ data: { post: null } }) });
  assert.equal(await fetchPost('p1'), null);

  globalThis.fetch = async () => ({ ok: false, status: 502, json: async () => { throw new Error('<html>'); } });
  await assert.rejects(fetchPost('p1'), /velog 서버 오류 \(502\)/);
});
