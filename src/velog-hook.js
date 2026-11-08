// velog 페이지 안(MAIN world)에서 실행된다. velog 요청 형식에 대한 지식은 전부 이 파일에만 둔다.
// velog가 API를 바꾸면 이 파일만 고치면 된다.
//
// 여기서는 velog에서 출간·수정·삭제가 성공했다는 사실과 글 id만 알린다.
// 같은 페이지의 다른 스크립트도 이 메시지를 흉내 낼 수 있으므로, 확장은 글 내용을 믿지 않고
// velog 서버에서 직접 다시 받아 확인한다.
(() => {
  const GRAPHQL = 'https://v2.velog.io/graphql';
  const OPS = { WritePost: 'publish', EditPost: 'publish', RemovePost: 'remove' };
  const originalFetch = window.fetch;
  const send = (msg) => window.postMessage({ source: 'veloghub', ...msg }, location.origin);

  function report(op, request, response) {
    if (request.variables?.is_temp) return; // 임시저장은 커밋하지 않는다
    const id =
      op === 'remove'
        ? response.data?.removePost && request.variables?.id
        : (response.data?.writePost ?? response.data?.editPost)?.id;
    if (id) send({ op, id }); // 없으면 velog 쪽에서 실패한 요청이라 velog가 직접 알려 준다
  }

  window.fetch = async function (input, init) {
    const response = await originalFetch.apply(this, arguments);
    let op, request;
    try {
      const url = String(input instanceof Request ? input.url : input);
      if (!url.startsWith(GRAPHQL) || typeof init?.body !== 'string') return response;
      request = JSON.parse(init.body);
      op = OPS[request.operationName];
    } catch {
      return response; // 가로채기에서 무슨 일이 생겨도 velog 동작은 막지 않는다
    }
    if (op) {
      try {
        // velog(Apollo)는 응답을 다 읽은 뒤 요청을 abort하는데, 그러면 아직 안 읽은 복사본도 끊긴다.
        // 그래서 응답을 넘기기 전에 복사본을 먼저 다 읽어 둔다.
        report(op, request, await response.clone().json());
      } catch (e) {
        send({ op, error: e.message });
      }
    }
    return response;
  };
})();
