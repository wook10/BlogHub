// velog 페이지 안(MAIN world)에서 실행된다. velog 요청 형식에 대한 지식은 전부 이 파일에만 둔다.
// velog가 API를 바꾸면 이 파일만 고치면 된다.
(() => {
  const GRAPHQL = 'https://v2.velog.io/graphql';
  const PUBLISH_OPS = ['WritePost', 'EditPost'];
  const POST_INFO = `query ($username: String, $url_slug: String) {
    post(username: $username, url_slug: $url_slug) { released_at series { name } }
  }`;
  const originalFetch = window.fetch;

  async function postInfo(username, url_slug) {
    const res = await originalFetch(GRAPHQL, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: POST_INFO, variables: { username, url_slug } }),
    });
    return (await res.json()).data?.post;
  }

  async function report(request, response) {
    const v = request.variables ?? {};
    if (v.is_temp) return; // 임시저장은 커밋하지 않는다
    console.info('[VelogHub] 출간 감지', request.operationName);
    const saved = response.data?.writePost ?? response.data?.editPost;
    if (!saved) throw new Error(response.errors?.[0]?.message ?? 'velog 응답에 글 정보가 없어요');
    const info = await postInfo(saved.user.username, saved.url_slug).catch(() => null);
    window.postMessage(
      {
        source: 'veloghub',
        post: {
          id: saved.id,
          title: v.title,
          body: v.body,
          tags: v.tags ?? [],
          is_private: !!v.is_private,
          username: saved.user.username,
          url_slug: saved.url_slug,
          series: info?.series?.name ?? null,
          released_at: info?.released_at ?? new Date().toISOString(),
        },
      },
      location.origin,
    );
  }

  // shortcut: velog(Apollo)는 fetch만 쓰므로 XHR은 가로채지 않음, velog가 XHR로 바꾸면 추가
  const fail = (e) =>
    window.postMessage({ source: 'veloghub', error: `출간 감지 중 오류: ${e.message}` }, location.origin);

  window.fetch = async function (input, init) {
    const response = await originalFetch.apply(this, arguments);
    let request;
    try {
      const url = String(input instanceof Request ? input.url : input);
      if (!url.startsWith(GRAPHQL) || typeof init?.body !== 'string') return response;
      request = JSON.parse(init.body);
    } catch {
      return response; // 가로채기에서 무슨 일이 생겨도 velog 동작은 막지 않는다
    }
    if (PUBLISH_OPS.includes(request.operationName)) {
      try {
        // velog(Apollo)는 응답을 다 읽은 뒤 요청을 abort하는데, 그러면 아직 안 읽은 복사본도 끊긴다.
        // 그래서 응답을 넘기기 전에 복사본을 먼저 다 읽어 둔다.
        const data = await response.clone().json();
        report(request, data).catch(fail);
      } catch (e) {
        fail(e);
      }
    }
    return response;
  };
})();
