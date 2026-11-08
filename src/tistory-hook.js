// 티스토리 관리 화면 안(MAIN world)에서 실행된다. 티스토리 요청 형식에 대한 지식은 이 파일과 tistory.js에만 둔다.
//
// 발행·수정(XMLHttpRequest)과 삭제(fetch)가 성공했다는 사실과 글 번호만 알린다.
// 확장은 글 내용을 믿지 않고 티스토리 서버에서 다시 받아 확인한다.
// shortcut: 글 관리 목록의 여러 글 한꺼번에 삭제·공개 범위 바꾸기는 아직 알아차리지 못한다.
(() => {
  const POST = /^\/manage\/post(?:\/(\d+))?\.json$/; // 새 글: POST post.json, 수정: PUT post/번호.json
  const send = (msg) => window.postMessage({ source: 'bloghub', ...msg }, location.origin);
  const match = (url) => {
    try {
      return new URL(url, location.href).pathname.match(POST);
    } catch {
      return null;
    }
  };

  const { open, send: xhrSend } = XMLHttpRequest.prototype;
  XMLHttpRequest.prototype.open = function (method, url) {
    this._bloghub = { method: String(method).toUpperCase(), m: match(url) };
    return open.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function (body) {
    const req = this._bloghub;
    if (req?.m && (req.method === 'POST' || req.method === 'PUT')) {
      this.addEventListener('load', () => {
        if (this.status < 200 || this.status >= 300) return; // 실패는 티스토리가 직접 알려 준다
        try {
          if (JSON.parse(body).type !== 'post') return; // 페이지·서식은 저장하지 않는다
          // 새 글은 응답의 글 주소(https://블로그/번호) 끝에서 번호를 얻는다
          const id = req.m[1] ?? JSON.parse(this.responseText).entryUrl?.match(/\/(\d+)$/)?.[1];
          send(id ? { op: 'publish', id } : { op: 'publish', error: '글 번호를 찾지 못했어요' });
        } catch (e) {
          send({ op: 'publish', error: e.message });
        }
      }, { once: true }); // 같은 XHR을 다시 써도 저장 한 번에 알림 한 번
    }
    return xhrSend.apply(this, arguments);
  };

  const originalFetch = window.fetch;
  window.fetch = async function (input, init) {
    const response = await originalFetch.apply(this, arguments);
    try {
      const isRequest = input instanceof Request;
      const method = String(init?.method ?? (isRequest ? input.method : 'GET')).toUpperCase();
      const m = match(isRequest ? input.url : String(input));
      if (method === 'DELETE' && m?.[1] && response.ok) send({ op: 'remove', id: m[1] });
    } catch {
      // 가로채기에서 무슨 일이 생겨도 티스토리 동작은 막지 않는다
    }
    return response;
  };
})();
