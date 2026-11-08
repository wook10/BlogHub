// velog 페이지의 확장 쪽(isolated world). velog-hook.js가 보낸 소식을 백그라운드로 넘기고 결과를 알림으로 보여 준다.

function toast(text, ok) {
  const el = document.createElement('div');
  el.setAttribute('role', 'status');
  el.textContent = text;
  el.style.cssText = `position:fixed;right:24px;bottom:24px;z-index:2147483647;padding:12px 16px;
    border-radius:8px;font:14px system-ui,sans-serif;color:#fff;background:${ok ? '#12b886' : '#e03131'};
    box-shadow:0 4px 12px rgba(0,0,0,.2)`;
  document.body.append(el);
  setTimeout(() => el.remove(), ok ? 3000 : 6000);
}

window.addEventListener('message', async (e) => {
  // 같은 창에서 온 VelogHub 메시지만 받는다 (광고 iframe 등은 제외). 내용 확인은 백그라운드가 한다.
  if (e.source !== window || e.data?.source !== 'veloghub') return;
  const { op, id, error } = e.data;
  if (op !== 'publish' && op !== 'remove') return;
  try {
    const res = await chrome.runtime.sendMessage({ type: op, id, error });
    toast(res.ok ? res.data : `GitHub ${op === 'remove' ? '삭제' : '저장'} 실패: ${res.error}`, res.ok);
  } catch {
    toast('VelogHub가 업데이트됐어요. 페이지를 새로고침해 주세요.', false);
  }
});
