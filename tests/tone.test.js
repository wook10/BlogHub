import { test } from 'node:test';
import assert from 'node:assert/strict';
import { protect, restore, rewriteTone, retry } from '../src/tone.js';

const md = '# 제목\n저는 `useState`를 썼습니다.\n![그림](images/1.png)\n```js\nconst a = 1;\n```\n자세한 건 https://react.dev 참고.';

const ok = (text, extra = {}) => ({
  ok: true, status: 200,
  json: async () => ({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text }] } }], ...extra }),
});
const fail = (status, error = {}) => ({ ok: false, status, json: async () => ({ error }) });
retry.wait = async () => {}; // 재시도 대기는 건너뛴다

test('protect/restore: 코드·이미지·주소는 AI에 보내지 않고 그대로 되돌린다', () => {
  const { text, kept } = protect(md);
  assert.ok(!text.includes('useState') && !text.includes('images/1.png') && !text.includes('const a'));
  assert.equal(restore(text, kept), md);
  // 자리표시자가 하나라도 빠지면 저장하지 않는다
  assert.throws(() => restore(text.replace('⟦0⟧', ''), kept), /코드나 링크/);
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

test('rewriteTone: Gemini에 요청하고 바꾼 글에 원래 코드를 되돌려 넣는다', async () => {
  let sent;
  globalThis.fetch = async (url, init) => {
    sent = { url, headers: init.headers, body: JSON.parse(init.body) };
    const input = sent.body.contents[0].parts[0].text;
    // AI가 말투만 바꿨다고 치고 자리표시자는 그대로 둔다 (생각 조각(thought)은 버려진다)
    return {
      ok: true, status: 200,
      json: async () => ({
        candidates: [{
          finishReason: 'STOP',
          content: { parts: [{ thought: true, text: '속으로 생각' }, { text: input.replace('저는', '나는').replace('썼습니다', '썼다') }] },
        }],
      }),
    };
  };
  const out = await rewriteTone('key', md, 'first');
  assert.equal(out, md.replace('저는', '나는').replace('썼습니다', '썼다'));
  assert.match(sent.url, /^https:\/\/generativelanguage\.googleapis\.com\/v1beta\/models\/gemini-[\w.-]+:generateContent$/);
  assert.equal(sent.headers['x-goog-api-key'], 'key');
  assert.match(sent.body.systemInstruction.parts[0].text, /1인칭/);
  await assert.rejects(rewriteTone('key', md, 'weird'), /말투 설정/);
  await assert.rejects(rewriteTone('key', md, 'toString'), /말투 설정/);
});

test('ask: 키 오류·연결 오류·하루 한도는 가져오기를 멈추게 표시한다', async () => {
  globalThis.fetch = async () => fail(400, { message: 'API key not valid.', details: [{ reason: 'API_KEY_INVALID' }] });
  await assert.rejects(rewriteTone('bad', 'x', 'first'), (e) => e.stopAll && /API 키가 맞지 않아요/.test(e.message));
  globalThis.fetch = async () => fail(401, { message: 'invalid credentials' });
  await assert.rejects(rewriteTone('bad', 'x', 'first'), (e) => e.stopAll && /API 키가 맞지 않아요/.test(e.message));
  // 키는 맞는데 구글이 막은 것: 키가 틀렸다고 안내하지 않는다
  globalThis.fetch = async () => fail(403, { message: 'The Gemini API free tier is not available for this project. To use the Gemini API, please set up billing', status: 'PERMISSION_DENIED' });
  await assert.rejects(rewriteTone('k', 'x', 'first'), (e) => e.stopAll && /무료로 쓸 수 없다/.test(e.message) && !/키가 맞지/.test(e.message));
  globalThis.fetch = async () => fail(403, { message: 'API has not been used in project 123 before' });
  await assert.rejects(rewriteTone('k', 'x', 'first'), (e) => e.stopAll && /막았어요/.test(e.message) && /API has not been used/.test(e.message));
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
  await assert.rejects(rewriteTone('k', 'x', 'first'), (e) => e.stopAll && /연결하지 못했어요/.test(e.message));
  globalThis.fetch = async () => fail(429, { message: 'quota', details: [{ violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel' }] }] });
  await assert.rejects(rewriteTone('k', 'x', 'first'), (e) => e.stopAll && /하루|오늘/.test(e.message));
});

test('ask: 분당 한도(429)와 서버가 바쁠 때는 기다렸다 다시 해서 성공하면 이어 간다', async () => {
  let calls = 0;
  const waits = [];
  retry.wait = async (ms) => waits.push(ms);
  globalThis.fetch = async (url, init) => {
    calls++;
    if (calls === 1) return fail(429, { message: 'slow down', details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '17s' }] });
    if (calls === 2) return fail(503, { message: 'overloaded' });
    return ok(JSON.parse(init.body).contents[0].parts[0].text);
  };
  assert.equal(await rewriteTone('k', 'x', 'first'), 'x');
  assert.equal(calls, 3);
  assert.deepEqual(waits, [18000, 16000]); // 권장 대기 17초(+1), 정보가 없으면 15초(+1)

  // 계속 안 되면: 분당 한도는 멈추고, 서버 오류는 그 글만 건너뛴다
  globalThis.fetch = async () => fail(429, { message: 'slow' });
  await assert.rejects(rewriteTone('k', 'x', 'first'), (e) => e.stopAll);
  globalThis.fetch = async () => fail(503, { message: 'overloaded' });
  await assert.rejects(rewriteTone('k', 'x', 'first'), (e) => !e.stopAll && /503/.test(e.message));
  retry.wait = async () => {};
});

test('ask: 글 하나만의 문제(길이·거절·코드 변경·시간 초과)는 멈추지 않고 그 글만 건너뛴다', async () => {
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: '일부' }] } }] }) });
  await assert.rejects(rewriteTone('k', 'x', 'first'), (e) => !e.stopAll && /너무 길어/.test(e.message));
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ promptFeedback: { blockReason: 'SAFETY' } }) });
  await assert.rejects(rewriteTone('k', 'x', 'first'), (e) => !e.stopAll && /거절/.test(e.message));
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ candidates: [{ finishReason: 'SAFETY' }] }) });
  await assert.rejects(rewriteTone('k', 'x', 'first'), (e) => !e.stopAll && /거절/.test(e.message));
  globalThis.fetch = async () => ok('다른 글'); // 코드가 사라졌다
  await assert.rejects(rewriteTone('k', '`a`', 'first'), (e) => !e.stopAll && /코드나 링크/.test(e.message));
  globalThis.fetch = async () => { throw Object.assign(new Error('t'), { name: 'TimeoutError' }); };
  await assert.rejects(rewriteTone('k', 'x', 'first'), (e) => !e.stopAll && /너무 늦어/.test(e.message));
});

test('ask: 모델을 못 찾거나 지역 제한이면 모든 글이 같게 실패하니 멈춘다', async () => {
  globalThis.fetch = async () => fail(404, { message: 'models/x is not found', status: 'NOT_FOUND' });
  await assert.rejects(rewriteTone('k', 'x', 'first'), (e) => e.stopAll && /쓸 수 없어요/.test(e.message));
  globalThis.fetch = async () => fail(400, { message: 'User location is not supported', status: 'FAILED_PRECONDITION' });
  await assert.rejects(rewriteTone('k', 'x', 'first'), (e) => e.stopAll && /쓸 수 없어요/.test(e.message));
});

test('ask: 하루 한도 표시가 오류 메시지에만 있어도 알아본다', async () => {
  globalThis.fetch = async () => fail(429, { message: 'Quota exceeded for metric: generate_content_free_tier_requests, limit: 500 per day' });
  await assert.rejects(rewriteTone('k', 'x', 'first'), (e) => e.stopAll && /오늘/.test(e.message));
});

test('ask: 기다릴 때 몇 초인지 알려 준다', async () => {
  const told = [];
  let calls = 0;
  retry.wait = async () => {};
  globalThis.fetch = async (url, init) => (++calls === 1 ? fail(429, { message: 'slow', details: [{ '@type': 'x.RetryInfo', retryDelay: '9s' }] }) : ok(JSON.parse(init.body).contents[0].parts[0].text));
  await rewriteTone('k', 'x', 'first', null, (s) => told.push(s));
  assert.deepEqual(told, [10]);
});
