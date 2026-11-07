// 백그라운드에서 쓰는 velog API. (velog 페이지 안에서 쓰는 요청 형식은 velog-hook.js에 있다)
const GRAPHQL = 'https://v2.velog.io/graphql';
const PAGE = 20;
const POSTS = `query ($username: String, $cursor: ID, $limit: Int) {
  posts(username: $username, cursor: $cursor, limit: $limit) {
    id title body tags is_private url_slug released_at series { name }
  }
}`;

// 한 사람의 글 전체. velog-hook.js가 보내는 글과 같은 모양으로 맞춘다.
// shortcut: 로그인 쿠키 없이 불러서 공개 글만 옴, 비공개 과거 글이 필요하면 velog 페이지 안에서 불러오도록 바꿈
export async function fetchAllPosts(username, onPage) {
  const posts = [];
  for (let cursor = null; ; cursor = posts.at(-1).id) {
    const res = await fetch(GRAPHQL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: POSTS, variables: { username, cursor, limit: PAGE } }),
    });
    const { data, errors } = await res.json();
    if (errors?.length) throw new Error(errors[0].message);
    if (!data?.posts) throw new Error('velog 글 목록을 불러오지 못했어요. 아이디를 확인해 주세요.');
    posts.push(...data.posts.map((p) => ({ ...p, username, series: p.series?.name ?? null })));
    await onPage?.(posts.length);
    if (data.posts.length < PAGE) return posts;
  }
}
