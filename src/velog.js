// 백그라운드에서 쓰는 velog API. (velog 페이지 안에서 쓰는 요청 형식은 velog-hook.js에 있다)
const GRAPHQL = 'https://v2.velog.io/graphql';
const PAGE = 20;
const FIELDS = 'id title body tags is_private is_temp url_slug released_at series { name } user { username }';

async function gql(query, variables) {
  const res = await fetch(GRAPHQL, {
    method: 'POST',
    credentials: 'include', // 비공개 글은 velog 로그인 쿠키가 있어야 보인다
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`velog 서버 오류 (${res.status})`);
  const { data, errors } = await res.json();
  if (errors?.length) throw new Error(`velog: ${errors[0].message}`);
  return data;
}

// velog 글을 저장에 쓰는 모양으로 바꾼다. 꼭 있어야 하는 값이 없으면 오류.
export function normalize(p) {
  if (!p?.id || !p.url_slug || !p.released_at || !p.user?.username || typeof p.title !== 'string') {
    throw new Error(`글 정보가 이상해요: ${p?.title ?? p?.id}`);
  }
  return {
    id: p.id,
    title: p.title,
    body: p.body ?? '',
    tags: p.tags ?? [],
    is_private: !!p.is_private,
    is_temp: !!p.is_temp,
    url_slug: p.url_slug,
    released_at: p.released_at,
    series: p.series?.name ?? null,
    username: p.user.username,
  };
}

// 글 하나. 지워졌거나 볼 수 없으면 null.
export async function fetchPost(id) {
  const data = await gql(`query ($id: ID) { post(id: $id) { ${FIELDS} } }`, { id });
  return data?.post ? normalize(data.post) : null;
}

// 한 사람의 글 전체 (velog 응답 그대로). 이상한 글은 가져오는 쪽에서 normalize로 걸러 낸다.
export async function fetchAllPosts(username, onPage) {
  const posts = [];
  for (let cursor = null; ; cursor = posts.at(-1).id) {
    const data = await gql(
      `query ($username: String, $cursor: ID, $limit: Int) {
        posts(username: $username, cursor: $cursor, limit: $limit) { ${FIELDS} }
      }`,
      { username, cursor, limit: PAGE },
    );
    if (!data?.posts) throw new Error('velog 글 목록을 불러오지 못했어요. 아이디를 확인해 주세요.');
    posts.push(...data.posts);
    await onPage?.(posts.length);
    if (data.posts.length < PAGE) return posts;
  }
}
