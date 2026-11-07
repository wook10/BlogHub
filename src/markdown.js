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

// velog의 url_slug는 계정 안에서 겹치지 않고 제목으로 만들어지므로 파일 이름으로 쓴다.
export function filePath(post, date) {
  const name = post.url_slug.replace(/[\\/:*?"<>|#%\s]+/g, '-');
  return `posts/${date}-${name}.md`;
}
