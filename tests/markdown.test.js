import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toMarkdown, filePath, indexPostFiles, candidateFiles, sourceLine, imageDir, relativeLink, cleanFolder, folderList, isRepoName } from '../src/markdown.js';

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

test('파일 경로에서 경로를 깨는 문자를 바꾸고, 바꿨으면 글 id를 붙여 겹치지 않게 한다', () => {
  assert.equal(filePath({ id: 'abcdef1234', url_slug: 'a/b?c d' }, '2026-11-07'), 'posts/2026-11-07-a-b-c-d-abcdef12.md');
  assert.notEqual(
    filePath({ id: '11111111x', url_slug: 'c#-tips' }, '2026-11-07'),
    filePath({ id: '22222222x', url_slug: 'c%-tips' }, '2026-11-07'),
  );
  assert.equal(filePath({ id: 'i', url_slug: 'x', series: '../비밀' }, '2026-11-07'), 'posts/-비밀/2026-11-07-x.md');
  assert.equal(filePath({ id: 'i', url_slug: 'x', series: '..' }, '2026-11-07'), 'posts/untitled/2026-11-07-x.md');
});

test('이미지 링크는 주소를 통째로 바꿔서, 앞부분이 같은 다른 주소를 건드리지 않는다', async () => {
  const { replaceImages } = await import('../src/markdown.js');
  const a = 'https://velog.velcdn.com/images/u/a.png';
  const body = `![](${a}) ![](${a}?w=300)`;
  assert.equal(replaceImages(body, new Map([[a, 'images/x/1.png']])), `![](images/x/1.png) ![](${a}?w=300)`);
});

test('본문에서 velog 이미지만 중복 없이 찾는다', async () => {
  const { findImages } = await import('../src/markdown.js');
  const a = 'https://velog.velcdn.com/images/u/post/1/image.png';
  const body = `![](${a})\n![](${a})\n<img src="https://images.velog.io/x.jpg">\n![](https://other.com/y.png)`;
  assert.deepEqual(findImages(body), [a, 'https://images.velog.io/x.jpg']);
});

test('이미지 폴더, 이름, 상대 링크', async () => {
  const { imageDir, imageName, relativeLink } = await import('../src/markdown.js');
  assert.equal(imageDir('posts/리액트 공부/2026-11-08-a.md'), 'posts/images/2026-11-08-a');
  assert.equal(imageName('https://x/image.PNG', 0), '1.png');
  assert.equal(imageName('https://x/blob', 1, 'image/svg+xml'), '2.svg');
  assert.equal(imageName('https://x/blob', 2, 'application/octet-stream'), '3.png');
  assert.equal(relativeLink('posts/a.md', 'posts/images/a/1.png'), 'images/a/1.png');
  assert.equal(relativeLink('posts/리액트/a.md', 'posts/images/a/1.png'), '../images/a/1.png');
});

test('티스토리 글은 tistory_url을 남긴다', () => {
  const md = toMarkdown({ ...post, series: null, source: 'tistory', url: 'https://me.tistory.com/1' }, '2026-11-08');
  assert.match(md, /^tistory_url: https:\/\/me\.tistory\.com\/1$/m);
  assert.doesNotMatch(md, /velog_url/);
});

test('저장소 파일 이름으로 이 글일 수 있는 파일을 고른다', () => {
  const f = (path) => ({ path, sha: path });
  const index = indexPostFiles([
    f('README.md'),
    f('posts/2026-11-08-hello-world.md'),
    f('posts/리액트/2026-11-01-c--tips-abcdef12.md'),
    f('posts/2026-11-09-my-post-345.md'),
    f('posts/2026-11-09-top-10.md'),
    f('posts/images/2026-11-08-hello-world/1.png'),
  ]);
  const paths = (q) => candidateFiles(index, q).map((x) => x.path);
  // velog: 글 주소로 파일 이름을 만들어 본다 (시리즈 폴더, 바뀐 문자 포함)
  assert.deepEqual(paths({ id: 'x', slug: 'hello-world' }), ['posts/2026-11-08-hello-world.md']);
  assert.deepEqual(paths({ id: 'abcdef1234', slug: 'c#-tips' }), ['posts/리액트/2026-11-01-c--tips-abcdef12.md']);
  assert.deepEqual(paths({ id: 'y', slug: 'hello' }), []);
  // 티스토리: 이름 끝 번호. velog의 top-10도 후보는 되지만 파일 속 글 주소로 걸러진다.
  assert.deepEqual(paths({ id: '345' }), ['posts/2026-11-09-my-post-345.md']);
  assert.deepEqual(paths({ id: '10' }), ['posts/2026-11-09-top-10.md']);
  assert.deepEqual(paths({ id: '45' }), []);
});

test('글 주소 줄은 파일에 적는 줄과 같다', () => {
  const t = { ...post, series: null, source: 'tistory', url: 'https://me.tistory.com/1' };
  assert.ok(toMarkdown(t, '2026-11-08').split('\n').includes(sourceLine(t)));
  assert.ok(toMarkdown(post, '2026-11-08').split('\n').includes(sourceLine(post)));
});

test('티스토리 카테고리 폴더 (시리즈가 없을 때)', () => {
  assert.equal(filePath({ id: '1', url_slug: 'x-1', series: null, category: '개발/일상' }, '2026-11-07'), 'posts/개발-일상/2026-11-07-x-1.md');
});

test('저장 폴더: 고른 폴더 안에 글, 맨 위 폴더 아래 images/에 이미지, 상대 링크', () => {
  const p = { id: 'i', url_slug: 'x', series: '리액트' };
  assert.equal(filePath(p, '2026-11-07', 'TIL/블로그'), 'TIL/블로그/리액트/2026-11-07-x.md');
  assert.equal(imageDir('TIL/블로그/리액트/2026-11-07-x.md'), 'TIL/images/2026-11-07-x');
  assert.equal(relativeLink('TIL/블로그/리액트/2026-11-07-x.md', 'TIL/images/2026-11-07-x/1.png'), '../../images/2026-11-07-x/1.png');
  // 예전과 같은 모양 (posts)
  assert.equal(relativeLink('posts/a.md', 'posts/images/a/1.png'), 'images/a/1.png');
  assert.equal(relativeLink('posts/시리즈/a.md', 'posts/images/a/1.png'), encodeURI('../images/a/1.png'));
});

test('cleanFolder: 위험한 경로를 막고 비면 posts', () => {
  assert.equal(cleanFolder(' TIL/ 블로그/ '), 'TIL/블로그');
  assert.equal(cleanFolder('../../etc'), 'untitled/untitled/etc');
  assert.equal(cleanFolder('.github/x'), 'github/x');
  assert.equal(cleanFolder(''), 'posts');
  assert.equal(cleanFolder(undefined), 'posts');
});

test('folderList: 저장소 폴더 목록 (숨김 폴더·이미지 폴더 제외)', () => {
  assert.deepEqual(
    folderList(['README.md', 'FE/React/a.md', 'posts/images/2026-11-07-x/1.png', 'posts/b.md', '.github/workflows/c.yml']),
    ['FE', 'posts', 'FE/React', 'posts/images'],
  );
});

test('folderList: 사용자가 만든 images 폴더는 보이고, BlogHub 글별 이미지 폴더는 숨긴다 (얕은 폴더부터)', () => {
  assert.deepEqual(folderList(['FE/images/logo.png', 'posts/images/2026-11-07-x/1.png', 'a/b/c.md']), [
    'a', 'FE', 'posts', 'a/b', 'FE/images', 'posts/images',
  ]);
});

test('isRepoName: 아이디/저장소만, 경로를 빠져나가는 이름은 막는다', () => {
  for (const ok of ['wook10/TIL', 'a-b/my.repo_1', 'wook10/.github']) assert.equal(isRepoName(ok), true, ok);
  for (const bad of ['../evil', 'a/..', 'a/.', 'a/b/c', '/x', 'x', '', undefined, 'a b/c']) assert.equal(isRepoName(bad), false, String(bad));
});
