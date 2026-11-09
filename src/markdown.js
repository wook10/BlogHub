// JSON 문자열은 그대로 YAML의 큰따옴표 문자열이 된다 (콜론, 따옴표가 든 제목도 안전).
const yaml = (value) => JSON.stringify(value);

// 글 주소 줄. 저장소의 파일이 어느 블로그의 어느 글인지 알아볼 때도 쓴다.
export const sourceLine = (post) =>
  post.source === 'tistory'
    ? `tistory_url: ${post.url}`
    : `velog_url: https://velog.io/@${post.username}/${encodeURIComponent(post.url_slug)}`;

export function toMarkdown(post, date) {
  return [
    '---',
    `title: ${yaml(post.title)}`,
    `date: ${date}`,
    `tags: ${yaml(post.tags)}`,
    ...(post.series ? [`series: ${yaml(post.series)}`] : []),
    sourceLine(post),
    '---',
    '',
    post.body,
    '',
  ].join('\n');
}

// velog 이미지와 티스토리 이미지 (blog.kakaocdn.net)
const VELOG_IMAGE = /https:\/\/(?:velog\.velcdn\.com|images\.velog\.io|blog\.kakaocdn\.net)\/[^\s)"'<>\]]+/g;

// 본문 속 블로그 이미지 주소 (중복 제거)
export const findImages = (body) => [...new Set(body.match(VELOG_IMAGE) ?? [])];

// 이미지 주소를 통째로 하나씩 바꾼다. 문자열 치환을 하면 a.png가 a.png?w=300의 앞부분까지 바꿔 버린다.
export const replaceImages = (body, links) => body.replace(VELOG_IMAGE, (url) => links.get(url) ?? url);

// posts/시리즈/2026-11-08-a.md → posts/images/2026-11-08-a
export const imageDir = (mdPath) => `posts/images/${mdPath.split('/').pop().replace(/\.md$/, '')}`;

const IMAGE_EXT = /^(png|jpe?g|gif|webp|svg|avif)$/i;

// 1.png, 2.jpg … velog 이미지는 이름이 전부 image.png라서 순서로 이름을 붙인다
export function imageName(url, index, contentType = '') {
  const fromUrl = url.split('?')[0].split('.').pop();
  const fromType = contentType.split('/')[1]?.split(/[+;]/)[0] ?? '';
  const ext = IMAGE_EXT.test(fromUrl) ? fromUrl : IMAGE_EXT.test(fromType) ? fromType : 'png';
  return `${index + 1}.${ext.toLowerCase()}`;
}

// 마크다운 파일에서 저장소 안 파일을 가리키는 상대 링크 (posts/시리즈/a.md → ../images/...)
export function relativeLink(mdPath, target) {
  const depth = mdPath.split('/').length - 2;
  return encodeURI('../'.repeat(depth) + target.slice('posts/'.length));
}

// 경로를 깨거나 상위 폴더로 빠져나가는 문자를 없앤다
const clean = (s) => s.replace(/[\\/:*?"<>|#%\x00-\x1f]+/g, '-').trim().replace(/^\.+/, '') || 'untitled';

// velog의 url_slug는 계정 안에서 겹치지 않고 제목으로 만들어지므로 파일 이름으로 쓴다.
// 시리즈에 속한 글은 posts/시리즈명/ 폴더에 둔다.
export function filePath(post, date) {
  const dir = post.series ? `posts/${clean(post.series)}` : 'posts';
  return `${dir}/${date}-${fileSlug(post)}.md`;
}

// 파일 이름에서 날짜와 .md를 뺀 부분
function fileSlug(post) {
  const name = clean(post.url_slug).replace(/\s+/g, '-');
  // 문자를 바꿨으면 다른 글(c#-tips와 c%-tips)과 이름이 겹칠 수 있어 글 id 앞부분을 붙인다
  return name === post.url_slug ? name : `${name}-${post.id.slice(0, 8)}`;
}

// 저장소의 글 파일({ path, sha })을 이름으로 찾기 쉽게 묶는다.
// bySlug: 날짜와 .md를 뺀 이름 → 파일들 (velog), byNumber: 이름 끝의 숫자 → 파일들 (티스토리 글 번호)
export function indexPostFiles(files) {
  const bySlug = new Map();
  const byNumber = new Map();
  const add = (map, key, file) => map.set(key, [...(map.get(key) ?? []), file]);
  for (const file of files) {
    if (!/^posts\/.*\.md$/.test(file.path)) continue;
    const name = file.path.split('/').pop().replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/\.md$/, '');
    add(bySlug, name, file);
    // 티스토리 파일 이름은 "주소-번호" 또는 "주소-번호-번호앞8자리"
    const [, a, b] = name.match(/(?:-(\d+))?-(\d+)$/) ?? [];
    for (const n of new Set([a, b].filter(Boolean))) add(byNumber, n, file);
  }
  return { bySlug, byNumber };
}

// 이 글일 수 있는 파일들. 이름만으로는 확실하지 않아(다른 블로그의 같은 번호 등) 파일 속 글 주소(sourceLine)로 확인해야 한다.
export const candidateFiles = ({ bySlug, byNumber }, { id, slug }) =>
  (slug ? bySlug.get(fileSlug({ id, url_slug: slug })) : byNumber.get(id)) ?? [];
