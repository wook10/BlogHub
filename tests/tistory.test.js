import { test } from 'node:test';
import assert from 'node:assert/strict';
import { htmlToMarkdown, parsePostPage, normalize, fetchPost, blogOrigin, listPostIds, originOf } from '../src/tistory.js';

const origin = 'https://me.tistory.com';
const raw = {
  id: '1',
  title: 'VelogHub 테스트',
  slogan: 'VelogHub-테스트',
  content: '<p data-ke-size="size16">본문 &amp; 내용</p>',
  orgPublished: '1794138854',
  visibility: 0,
  tags: ['a'],
};

test('htmlToMarkdown: 티스토리 편집기가 만드는 흔한 태그', () => {
  const html = [
    '<h2>제목</h2>',
    '<p data-ke-size="size16"><b>굵게</b> <i>기울임</i> <a href="https://x.com?a=1&amp;b=2">링크</a> <code>a&lt;b</code></p>',
    '<p data-ke-size="size16">&nbsp;</p>',
    '<ul><li>하나</li><li>둘<ol><li>안쪽</li></ol></li></ul>',
    '<blockquote data-ke-style="style1">인용<br>둘째 줄</blockquote>',
    '<pre class="javascript" data-ke-language="javascript"><code>if (a &lt; b) {\n\n\n  go();\n}</code></pre>',
    '<hr><table><tbody><tr><td>칸</td></tr></tbody></table>',
  ].join('');
  assert.equal(
    htmlToMarkdown(html),
    [
      '## 제목',
      '',
      '**굵게** *기울임* [링크](https://x.com?a=1&b=2) `a<b`',
      '',
      '- 하나',
      '- 둘',
      '  1. 안쪽',
      '',
      '> 인용',
      '> 둘째 줄',
      '',
      '```javascript',
      'if (a < b) {\n\n\n  go();\n}',
      '```',
      '',
      '---',
      '',
      '<table><tbody><tr><td>칸</td></tr></tbody></table>',
    ].join('\n'),
  );
});

test('htmlToMarkdown: 잘못된 문자 번호와 글자로 쓴 태그', () => {
  assert.equal(htmlToMarkdown('<p>&#99999999; &lt;div&gt; 태그</p>'), '&amp;#99999999; &lt;div> 태그');
  // 글자 그대로 쓴 &lt; 는 GitHub에서도 &lt; 로 보여야 한다
  assert.equal(htmlToMarkdown('<p>&amp;lt; 와 A&amp;B</p>'), '&amp;lt; 와 A&B');
});

test('htmlToMarkdown: 이미지 자리표시자는 카카오 CDN 이미지로', () => {
  const html =
    '<p>[##_Image|kage@abc/img.png|CDM|1.3|{"originWidth":10,"caption":"a|b"}_##]</p>' +
    '<p>[##_ImageGrid|kage@k1/1.jpg,kage@k2/2.jpg|data-origin-width="1"|_##]</p>' +
    '<p>[##_Gallery|kage@g1/a.jpg|cap|kage@g2/b.jpg|cap|_##]</p>';
  assert.equal(
    htmlToMarkdown(html),
    '![](https://blog.kakaocdn.net/dn/abc/img.png)\n\n' +
      '![](https://blog.kakaocdn.net/dn/k1/1.jpg)![](https://blog.kakaocdn.net/dn/k2/2.jpg)\n\n' +
      '![](https://blog.kakaocdn.net/dn/g1/a.jpg)![](https://blog.kakaocdn.net/dn/g2/b.jpg)',
  );
});

// 지워진 글을 열면 티스토리가 주는 페이지 (2026-11-08 실제 응답)
const DELETED = "<script>alert('잘못된 요청이거나 삭제된 글입니다.'); history.back();</script>";

test('parsePostPage: 수정 화면은 post, 삭제 안내는 null, 알 수 없는 화면은 오류', () => {
  // 실제 화면처럼 window.Config = { 와 } 가 각각 한 줄
  const page = `  window.Config = {\n    user: {"id":1},\n    post: ${JSON.stringify(raw)},\n    postType: "post",\n  }`;
  assert.deepEqual(parsePostPage(page), raw);
  // Config 블록 밖의 post: 줄은 무시한다
  const other = `var x = {\n  post: {"id":"999"},\n};\n${page}`;
  assert.deepEqual(parsePostPage(other), raw);
  assert.equal(parsePostPage(DELETED), null);
  // 화면 모양이 바뀌었다고 지워진 글로 착각하면 GitHub 백업이 지워진다
  assert.throws(() => parsePostPage('window.Config = {\n    postType: "post",\n};'), /읽지 못했어요/);
  assert.throws(() => parsePostPage('<html>점검 중</html>'), /읽지 못했어요/);
});

test('normalize: 공개 범위, 날짜, 파일 이름, 꼭 필요한 값', () => {
  const post = normalize(raw, origin);
  assert.equal(post.body, '본문 & 내용');
  assert.equal(post.is_private, true);
  assert.equal(normalize({ ...raw, visibility: 20 }, origin).is_private, false);
  assert.equal(normalize({ ...raw, visibility: 15 }, origin).is_private, true); // 보호글
  assert.equal(post.released_at, new Date(1794138854000).toISOString());
  assert.equal(post.url_slug, 'VelogHub-테스트-1');
  assert.equal(post.url, 'https://me.tistory.com/1');
  assert.throws(() => normalize({ ...raw, orgPublished: null }, origin));
  assert.throws(() => normalize({ ...raw, id: '../1' }, origin));
  assert.equal(normalize({ ...raw, id: 7 }, origin).id, '7'); // 숫자로 와도 문자열로
});

test('blogOrigin: 티스토리 블로그 주소만', () => {
  assert.equal(blogOrigin('https://me.tistory.com/manage/newpost'), origin);
  assert.throws(() => blogOrigin('https://www.tistory.com/'));
  assert.throws(() => blogOrigin('https://me.tistory.com.evil.com/manage/'));
  assert.throws(() => blogOrigin('http://me.tistory.com/manage/'));
});

test('fetchPost: 지워진 글은 null, 로그인 화면으로 넘어가면 오류', async () => {
  globalThis.fetch = async (url) => ({ ok: true, url, text: async () => DELETED });
  assert.equal(await fetchPost(origin, '1'), null);

  globalThis.fetch = async () => ({ ok: true, url: 'https://www.tistory.com/auth/login', text: async () => '' });
  await assert.rejects(fetchPost(origin, '1'), /로그인/);

  await assert.rejects(fetchPost(origin, '1/../2'), /글 번호/);
});

test('htmlToMarkdown: 백틱이 든 인라인 코드, 쉼표로 온 태그', () => {
  assert.equal(htmlToMarkdown('<p><code>a`b</code></p>'), '`` a`b ``');
  assert.deepEqual(normalize({ ...raw, tags: 'react, hooks' }, origin).tags, ['react', 'hooks']);
});

test('listPostIds: 여러 쪽의 글 번호를 모으고, 로그인 화면이면 오류', async () => {
  const pages = { 1: [{ id: 3 }, { id: 2 }], 2: [{ id: 1 }] };
  globalThis.fetch = async (url) => ({
    ok: true,
    json: async () => ({ totalCount: 3, items: pages[new URL(url).searchParams.get('page')] ?? [] }),
  });
  assert.deepEqual(await listPostIds(origin), ['3', '2', '1']);

  globalThis.fetch = async () => ({ ok: true, json: async () => { throw new SyntaxError('<html>'); } });
  await assert.rejects(listPostIds(origin), /로그인/);
});

test('originOf: 블로그 아이디로 주소, 이상한 아이디는 오류', () => {
  assert.equal(originOf(' Me '), origin);
  assert.throws(() => originOf('me.evil.com/x'));
  assert.throws(() => originOf('www'));
});
