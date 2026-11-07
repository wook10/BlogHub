import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toMarkdown, filePath } from '../src/markdown.js';

const post = {
  title: 'React: "상태" 관리',
  body: '# 본문\n내용',
  tags: ['React', '상태관리'],
  series: '리액트 공부',
  username: 'wook10',
  url_slug: 'React-상태-관리',
};

test('front matter를 붙인 마크다운을 만든다', () => {
  assert.equal(
    toMarkdown(post, '2026-11-07'),
    [
      '---',
      'title: "React: \\"상태\\" 관리"',
      'date: 2026-11-07',
      'tags: ["React","상태관리"]',
      'series: "리액트 공부"',
      'velog_url: https://velog.io/@wook10/React-%EC%83%81%ED%83%9C-%EA%B4%80%EB%A6%AC',
      '---',
      '',
      '# 본문\n내용',
      '',
    ].join('\n'),
  );
});

test('시리즈가 없으면 series 줄을 뺀다', () => {
  assert.doesNotMatch(toMarkdown({ ...post, series: null }, '2026-11-07'), /series:/);
});

test('시리즈 글은 시리즈 폴더에, 아니면 posts 바로 아래에 둔다', () => {
  assert.equal(filePath(post, '2026-11-07'), 'posts/리액트 공부/2026-11-07-React-상태-관리.md');
  assert.equal(filePath({ ...post, series: null }, '2026-11-07'), 'posts/2026-11-07-React-상태-관리.md');
});

test('파일 경로에서 경로를 깨는 문자를 바꾼다', () => {
  assert.equal(filePath({ url_slug: 'a/b?c d' }, '2026-11-07'), 'posts/2026-11-07-a-b-c-d.md');
  assert.equal(filePath({ url_slug: 'x', series: '../비밀' }, '2026-11-07'), 'posts/-비밀/2026-11-07-x.md');
  assert.equal(filePath({ url_slug: 'x', series: '..' }, '2026-11-07'), 'posts/untitled/2026-11-07-x.md');
});
