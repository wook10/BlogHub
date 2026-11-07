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

// 경로를 깨거나 상위 폴더로 빠져나가는 문자를 없앤다
const clean = (s) => s.replace(/[\\/:*?"<>|#%\x00-\x1f]+/g, '-').trim().replace(/^\.+/, '') || 'untitled';

// velog의 url_slug는 계정 안에서 겹치지 않고 제목으로 만들어지므로 파일 이름으로 쓴다.
// 시리즈에 속한 글은 posts/시리즈명/ 폴더에 둔다.
export function filePath(post, date) {
  const dir = post.series ? `posts/${clean(post.series)}` : 'posts';
  return `${dir}/${date}-${clean(post.url_slug).replace(/\s+/g, '-')}.md`;
}
