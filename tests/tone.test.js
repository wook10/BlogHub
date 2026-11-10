import { test } from 'node:test';
import assert from 'node:assert/strict';
import { protect, restore, rewriteTone } from '../src/tone.js';

const md = '# 제목\n저는 `useState`를 썼습니다.\n![그림](images/1.png)\n```js\nconst a = 1;\n```\n자세한 건 https://react.dev 참고.';

test('protect/restore: 코드·이미지·주소는 AI에 보내지 않고 그대로 되돌린다', () => {
  const { text, kept } = protect(md);
  assert.ok(!text.includes('useState') && !text.includes('images/1.png') && !text.includes('const a'));
  assert.equal(restore(text, kept), md);
  // 자리표시자가 하나라도 빠지면 저장하지 않는다
  assert.throws(() => restore(text.replace('⟦0⟧', ''), kept), /코드나 링크/);
});

test('rewriteTone: 바꾼 글에 원래 코드를 되돌려 넣는다, API 오류는 알기 쉽게', async () => {
  let sent;
  globalThis.fetch = async (url, init) => {
    sent = { url, headers: init.headers, body: JSON.parse(init.body) };
    // AI가 말투만 바꿨다고 치고 자리표시자는 그대로 둔다
    return { ok: true, status: 200, json: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: sent.body.messages[0].content.replace('저는', '나는').replace('썼습니다', '썼다') }] }) };
  };
  const out = await rewriteTone('key', md, 'first');
  assert.equal(out, md.replace('저는', '나는').replace('썼습니다', '썼다'));
  assert.equal(sent.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(sent.headers['x-api-key'], 'key');
  assert.equal(sent.body.model, 'claude-opus-5-5');
  assert.match(sent.body.system, /1인칭/);

  globalThis.fetch = async () => ({ ok: false, status: 401, json: async () => ({}) });
  await assert.rejects(rewriteTone('bad', md, 'first'), /API 키가 맞지 않아요/);
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ stop_reason: 'refusal', content: [] }) });
  await assert.rejects(rewriteTone('key', md, 'third'), /거절/);
  await assert.rejects(rewriteTone('key', md, 'weird'), /말투 설정/);
});

test('protect: 링크 글자는 말투를 바꾸고 주소만 지킨다, ~~~ 코드와 원래 있던 ⟦0⟧도 지킨다', () => {
  const src = '[제가 쓴 글](https://a.dev/x) 참고\n~~~\n저는 코드\n~~~\n글에 원래 ⟦0⟧이 있음';
  const { text, kept } = protect(src);
  assert.match(text, /\[제가 쓴 글⟦\d+⟧/); // 링크 글자는 AI에 보낸다
  assert.ok(!text.includes('a.dev') && !text.includes('저는 코드'));
  assert.equal(restore(text, kept), src); // 원래 있던 ⟦0⟧도 그대로 돌아온다
});

test('restore: AI가 자리표시자를 두 번 쓰면 저장하지 않는다', () => {
  const { text, kept } = protect('`a` 그리고 `b`');
  assert.throws(() => restore(`${text} ⟦0⟧`, kept), /코드나 링크/);
});

test('ask: 키·연결 오류는 가져오기를 멈추게 표시한다 (글 하나의 문제가 아님)', async () => {
  globalThis.fetch = async () => ({ ok: false, status: 401, json: async () => ({}) });
  await assert.rejects(rewriteTone('bad', 'x', 'first'), (e) => e.stopAll === true);
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
  await assert.rejects(rewriteTone('k', 'x', 'first'), (e) => e.stopAll && /연결하지 못했어요/.test(e.message));
  globalThis.fetch = async () => ({ ok: false, status: 400, json: async () => ({ error: { message: 'Your credit balance is too low' } }) });
  await assert.rejects(rewriteTone('k', 'x', 'first'), (e) => e.stopAll && /크레딧/.test(e.message));
  // 과부하·시간 초과는 그 글만 건너뛴다 (가져오기 전체를 멈추지 않는다)
  globalThis.fetch = async () => ({ ok: false, status: 529, json: async () => ({ error: { message: 'Overloaded' } }) });
  await assert.rejects(rewriteTone('k', 'x', 'first'), (e) => !e.stopAll);
  globalThis.fetch = async () => { throw Object.assign(new Error('t'), { name: 'TimeoutError' }); };
  await assert.rejects(rewriteTone('k', 'x', 'first'), (e) => !e.stopAll && /너무 늦어/.test(e.message));
  await assert.rejects(rewriteTone('k', 'x', 'toString'), /말투 설정/);
  // 글 하나만의 문제(코드가 바뀜)는 멈추지 않고 그 글만 건너뛴다
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: '다른 글' }] }) });
  await assert.rejects(rewriteTone('k', '`a`', 'first'), (e) => !e.stopAll);
});
