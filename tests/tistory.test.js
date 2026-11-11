import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPublic, categoryName, imagesToHtml, unescapeImgSrc, parsePostPage, normalize, fetchPost, blogOrigin, listPosts, originOf } from '../src/tistory.js';

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

test('imagesToHtml: 이미지 자리표시자를 카카오 CDN <img>로', () => {
  const img = (url) => `<img src="${url}">`;
  // 서명이 붙은 새 이미지는 /dna/ (2026-11-08 실제 글 모양), 본문에 적힌 & 표기는 그대로 둔다 (HTML을 읽을 때 풀린다)
  const signed = 'kage@ab/cd/img.png?credential=x&expires=1&signature=y%3D';
  assert.equal(imagesToHtml(`<p>[##_Image|${signed}|CDM|1.3|{"filename":"a.png"}_##]</p>`),
    `<p>${img('https://blog.kakaocdn.net/dna/ab/cd/img.png?credential=x&expires=1&signature=y%3D')}</p>`);
  // 서명 없는 예전 이미지는 /dn/
  assert.equal(imagesToHtml('[##_Image|kage@ab/img.png?original|CDM|1.3|{}_##]'), img('https://blog.kakaocdn.net/dn/ab/img.png?original'));
  // " < > 는 태그가 깨지지 않게 주소 표기로
  assert.equal(imagesToHtml('[##_Image|kage@ab/a<b>.png|CDM|1.3|{}_##]'), img('https://blog.kakaocdn.net/dn/ab/a%3Cb%3E.png'));
  // 캡션 속 | 에 흔들리지 않고, 그리드(쉼표)와 갤러리(칸마다)의 이미지를 모두 찾는다
  assert.equal(
    imagesToHtml(
      '[##_Image|kage@abc/img.png|CDM|1.3|{"caption":"a|b"}_##]' +
        '[##_ImageGrid|kage@k1/1.jpg,kage@k2/2.jpg|data-origin-width="1"|_##]' +
        '[##_Gallery|kage@g1/a.jpg|cap|kage@g2/b.jpg|cap|_##]',
    ),
    ['abc/img.png', 'k1/1.jpg', 'k2/2.jpg', 'g1/a.jpg', 'g2/b.jpg'].map((k) => img(`https://blog.kakaocdn.net/dn/${k}`)).join(''),
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

test('fetchPost: 본문은 이미지를 바꾼 뒤 변환기로, 지워진 글은 null, 로그인 화면이면 오류', async () => {
  const page = `  window.Config = {
    post: ${JSON.stringify({ ...raw, content: '<p>[##_Image|kage@a/b.png|CDM|1.3|{}_##]</p>' })},
  }`;
  globalThis.fetch = async (url) => ({ ok: true, url, text: async () => page });
  const seen = [];
  const post = await fetchPost(origin, '1', async (html) => (seen.push(html), ' 변환됨 \n'));
  assert.deepEqual(seen, ['<p><img src="https://blog.kakaocdn.net/dn/a/b.png"></p>']);
  assert.equal(post.body, '변환됨');

  globalThis.fetch = async (url) => ({ ok: true, url, text: async () => DELETED });
  assert.equal(await fetchPost(origin, '1'), null);

  globalThis.fetch = async () => ({ ok: true, url: 'https://www.tistory.com/auth/login', text: async () => '' });
  await assert.rejects(fetchPost(origin, '1'), /로그인한 뒤/);
  // 글 하나를 읽을 때도 목록과 같은 안내 (가져오는 도중에 연결이 끊기거나 로그인이 풀려도)
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
  await assert.rejects(fetchPost(origin, '1'), /연결하지 못했어요/);
  globalThis.fetch = async () => ({ ok: true, url: `${origin}/manage`, text: async () => '' });
  await assert.rejects(fetchPost(origin, '1'), /로그인한 뒤/);

  await assert.rejects(fetchPost(origin, '1/../2'), /글 번호/);
});

test('normalize: 쉼표로 온 태그', () => {
  assert.deepEqual(normalize({ ...raw, tags: 'react, hooks' }, origin).tags, ['react', 'hooks']);
});

test('listPosts: 여러 쪽의 글 번호·제목을 모으고, 로그인 화면이면 오류', async () => {
  const pages = { 1: [{ id: 3, title: 'c', visibility: 20 }, { id: 2, title: 'b', visibility: 0 }], 2: [{ id: 1, title: 'a', visibility: 20 }] };
  globalThis.fetch = async (url) => ({
    ok: true,
    url,
    json: async () => ({ totalCount: 3, items: pages[new URL(url).searchParams.get('page')] ?? [] }),
  });
  assert.deepEqual(await listPosts(origin), [
    { id: '3', title: 'c', isPrivate: false },
    { id: '2', title: 'b', isPrivate: true },
    { id: '1', title: 'a', isPrivate: false },
  ]);

  globalThis.fetch = async (url) => ({ ok: true, url, json: async () => { throw new SyntaxError('<html>'); } });
  await assert.rejects(listPosts(origin), /목록을 읽지 못했어요/);

  // 로그인 화면으로 넘어감, 없는 블로그
  globalThis.fetch = async () => ({ ok: true, url: 'https://www.tistory.com/auth/login?redirectUrl=x' });
  await assert.rejects(listPosts(origin), /로그인한 뒤/);
  globalThis.fetch = async (url) => ({ ok: false, status: 404, url });
  await assert.rejects(listPosts(origin), /me\.tistory\.com 블로그를 찾지 못했어요/);
  globalThis.fetch = async (url) => ({ ok: false, status: 403, url });
  await assert.rejects(listPosts(origin), /내 블로그가 아니에요/);
  // 연결 오류는 "블로그 없음"으로 착각하게 하지 않는다
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
  await assert.rejects(listPosts(origin), /연결하지 못했어요/);
});

test('originOf: 블로그 아이디로 주소, 이상한 아이디는 오류', () => {
  assert.equal(originOf(' Me '), origin);
  assert.equal(originOf('https://me.tistory.com/manage'), origin);
  assert.equal(originOf('me.tistory.com'), origin);
  assert.equal(originOf('http://me.tistory.com:443?x'), origin);
  assert.throws(() => originOf('me.evil.com/x'));
  assert.throws(() => originOf('www'));
});

test('unescapeImgSrc: HTML로 남은 표 속 이미지 주소의 & 표기만 푼다', () => {
  const md = '| 글 &amp; 표 |\n<table><tr><td><img src="https://blog.kakaocdn.net/dna/x.png?credential=a&amp;expires=1"></td></tr></table>';
  assert.equal(
    unescapeImgSrc(md),
    '| 글 &amp; 표 |\n<table><tr><td><img src="https://blog.kakaocdn.net/dna/x.png?credential=a&expires=1"></td></tr></table>',
  );
});

test('unescapeImgSrc: 코드 블록 속 예제는 그대로, 괄호 든 이미지 이름은 주소 표기로', () => {
  const code = '```html\n<img src="a.png?x=1&amp;y=2">\n```';
  assert.equal(unescapeImgSrc(code), code);
  assert.equal(imagesToHtml('[##_Image|kage@ab/a(1).png|CDM|1.3|{}_##]'), '<img src="https://blog.kakaocdn.net/dn/ab/a%281%29.png">');
});

test('categoryName: 블로그 정보에서 카테고리 이름 (하위 분류 포함), 모르면 null', () => {
  const blog = { categories: [{ id: 5, name: '개발', children: [{ id: 7, label: '리액트' }] }] };
  const page = `  window.Config = {\n    blog: ${JSON.stringify(blog)},\n    post: {"id":1},\n  }`;
  assert.equal(categoryName(page, 5), '개발');
  assert.equal(categoryName(page, '7'), '리액트');
  assert.equal(categoryName(page, 9), null);
  assert.equal(categoryName(page, 0), null); // 분류 없음
  assert.equal(categoryName('  window.Config = {\n    post: {"id":1},\n  }', 5), null); // 블로그 정보가 없어도 글은 저장
  assert.equal(categoryName('  window.Config = {\n    blog: {깨짐,\n  }', 5), null);
});

test('공개 범위: 수정 화면의 숫자(20)와 글 관리 목록의 글자("PUBLIC") 모두 공개로 알아보고, 모르는 값은 비공개', async () => {
  for (const v of [20, '20', -20, 'PUBLIC', 'public', ' PUBLIC ']) assert.equal(isPublic(v), true, String(v));
  for (const v of [0, 15, 'PRIVATE', 'PROTECTED', 'N', '', null, undefined, 'unknown', 'PUBLIC_PROTECTED', 'NOT_PUBLIC', true, [20], { v: 20 }]) assert.equal(isPublic(v), false, String(v));

  // 2026-11에 실제로 받은 목록 응답의 모양: 공개 글이 "PUBLIC"으로 온다
  globalThis.fetch = async (url) => ({
    ok: true,
    url,
    json: async () => ({ totalCount: 3, items: [{ id: '11', title: 'ㅁㅇㄴ', visibility: 'PUBLIC' }, { id: '10', title: '테스트', visibility: 'PUBLIC' }, { id: '9', title: '비밀', visibility: 'PRIVATE' }] }),
  });
  assert.deepEqual(await listPosts(origin), [
    { id: '11', title: 'ㅁㅇㄴ', isPrivate: false },
    { id: '10', title: '테스트', isPrivate: false },
    { id: '9', title: '비밀', isPrivate: true },
  ]);
});
