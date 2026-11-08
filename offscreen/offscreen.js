// 티스토리 편집기가 마크다운 모드에서 쓰는 것과 같은 설정 (2026-11 편집기 코드에서 확인)
// eslint-disable-next-line no-undef
const turndown = new TurndownService({ headingStyle: 'atx', hr: '---', bulletListMarker: '-', codeBlockStyle: 'fenced' });
// eslint-disable-next-line no-undef
turndown.use(turndownPluginGfm.gfm); // 표, 취소선, 체크리스트, 코드 강조
turndown.keep(['iframe']); // 영상 등은 HTML 그대로 (티스토리는 script도 남기지만, 백업 파일에 스크립트는 넣지 않는다)
turndown.remove(['script', 'style']);

// 티스토리 코드 블록은 언어를 <pre data-ke-language="javascript">에 적는다. turndown 기본 규칙은 <code class="language-..">만 봐서
// 언어가 빠지고, <code> 없는 <pre>는 코드 블록으로 보지 않는다. 그래서 <pre>는 직접 코드 블록으로 만든다.
turndown.addRule('tistoryCodeBlock', {
  filter: 'pre',
  replacement(_content, node) {
    const code = node.textContent.replace(/\n$/, '');
    const lang = node.getAttribute('data-ke-language') || node.querySelector('code')?.className.match(/language-(\S+)/)?.[1] || '';
    // 코드 속 ``` 보다 긴 울타리로 감싼다
    const fence = '`'.repeat(Math.max(3, ...(code.match(/`+/g) ?? []).map((t) => t.length + 1)));
    return `\n\n${fence}${lang}\n${code}\n${fence}\n\n`;
  },
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.target !== 'offscreen' || msg.type !== 'html-to-markdown') return;
  try {
    sendResponse({ ok: true, data: turndown.turndown(String(msg.html ?? '')) });
  } catch (e) {
    sendResponse({ ok: false, error: e.message });
  }
});
