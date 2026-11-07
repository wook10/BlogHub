// JSON 문자열은 그대로 YAML의 큰따옴표 문자열이 된다 (콜론, 따옴표가 든 제목도 안전).
const yaml = (value) => JSON.stringify(value);

export function toMarkdown(post, date) {
  return [
    '---',
    `title: ${yaml(post.title)}`,
    `date: ${date}`,
    `tags: ${yaml(post.tags)}`,
    ...(post.series ? [`series: ${yaml(post.series)}`] : []),
    `velog_url: https://velog.io/@${post.username}/${encodeURIComponent(post.url_slug)}`,
    '---',
    '',
    post.body,
    '',
  ].join('\n');
}

const VELOG_IMAGE = /https:\/\/(?:velog\.velcdn\.com|images\.velog\.io)\/[^\s)"'<>\]]+/g;

// 본문 속 velog 이미지 주소 (중복 제거)
export const findImages = (body) => [...new Set(body.match(VELOG_IMAGE) ?? [])];

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
  return `${dir}/${date}-${clean(post.url_slug).replace(/\s+/g, '-')}.md`;
}
