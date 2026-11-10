// 과거 글을 가져올 때 AI(Claude)로 말투를 바꾼다.
// BlogHub에는 서버가 없어서, 사용자가 설정에 넣은 Anthropic API 키로 이 브라우저에서 바로 부른다.
// SDK 대신 fetch를 쓰는 이유: 이 확장은 빌드 단계 없이 파일을 그대로 싣는다 (SDK를 넣으려면 번들러가 필요).

const API = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-opus-5-5';

export const TONES = {
  first: '1인칭 시점. 글쓴이가 "나는", "내가"로 자기 경험과 생각을 말하는 평서체(~했다, ~이다)로 쓴다.',
  third: '3인칭 설명체. 글쓴이를 드러내지 않고 대상을 객관적으로 설명하는 평서체(~이다, ~한다)로 쓴다. "나", "저" 같은 1인칭 표현은 쓰지 않는다.',
};

// 글 하나의 문제가 아니라 모든 글에서 똑같이 실패할 오류 (키, 연결, 요청 수). 가져오기를 바로 멈춘다.
export const stop = (message) => Object.assign(new Error(message), { stopAll: true });

async function ask(apiKey, system, text) {
  const res = await fetch(API, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2026-10-21',
      'anthropic-beta': 'server-side-fallback-2026-07-01', // 안전 검사로 거절되면 다른 모델로 다시 시도
      'anthropic-dangerous-direct-browser-access': 'true', // 서버 없이 브라우저(확장)에서 직접 부른다
    },
    signal: AbortSignal.timeout(5 * 60_000), // 응답이 끝없이 늦어 가져오기가 멈추지 않게
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 16000, // 스트리밍 없이 받을 수 있는 크기. 이보다 긴 글은 아래에서 오류로 알린다.
      output_config: { effort: 'low' }, // 말투만 바꾸는 일이라 깊게 생각할 필요가 없다
      fallbacks: 'default',
      system,
      messages: [{ role: 'user', content: text }],
    }),
  }).catch((e) => {
    // 시간 초과는 그 글이 길어서일 수 있어 그 글만 건너뛰고, 연결이 끊긴 건 모든 글이 같으니 멈춘다
    if (e.name === 'TimeoutError') throw new Error('AI 응답이 너무 늦어 이 글은 건너뛰었어요.');
    throw stop('Anthropic에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.');
  });
  const data = await res.json().catch(() => ({}));
  const reason = data.error?.message ?? '알 수 없는 오류';
  if (res.status === 401 || res.status === 403) throw stop('Anthropic API 키가 맞지 않아요. ⚙ 설정에서 확인해 주세요.');
  if (/credit balance/i.test(reason)) throw stop('Anthropic 크레딧이 모자라요. 콘솔에서 충전한 뒤 다시 해 주세요.');
  if (res.status === 429) throw stop('AI 요청이 너무 많아요. 잠시 뒤에 다시 해 주세요.');
  // 과부하(529)·서버 오류·이 글만의 문제(400 등)는 그 글만 건너뛴다
  if (!res.ok) throw new Error(`AI 오류 (${res.status}): ${reason}`);
  if (data.stop_reason === 'refusal') throw new Error('AI가 이 글의 말투 바꾸기를 거절했어요.');
  if (data.stop_reason === 'max_tokens') throw new Error('글이 너무 길어 말투를 바꾸지 못했어요.');
  const out = (data.content ?? []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
  if (!out) throw new Error('AI가 빈 글을 돌려줬어요. 다시 해 주세요.');
  return out;
}

// 바꾸면 안 되는 부분은 자리표시자 ⟦번호⟧로 감춰 보낸다:
// 코드 블록(``` ~~~), 인라인 코드, 이미지, 링크 주소(링크 글자는 말투를 바꾼다), HTML 태그, 주소, 글에 원래 있던 ⟦번호⟧
const KEEP = /```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]+`|!\[[^\]\n]*\]\([^)\n]*\)|\]\([^)\n]*\)|<[^>\n]+>|https?:\/\/[^\s)]+|⟦\d+⟧/g;

export function protect(md) {
  const kept = [];
  return { text: md.replace(KEEP, (m) => `⟦${kept.push(m) - 1}⟧`), kept };
}

// 모두 꼭 한 번씩 돌아와야 한다: 빠지거나 겹치면 코드나 이미지가 깨진 글이라 저장하지 않는다
export function restore(text, kept) {
  const count = new Map();
  const out = text.replace(/⟦(\d+)⟧/g, (whole, i) => {
    if (kept[i] === undefined) return whole;
    count.set(i, (count.get(i) ?? 0) + 1);
    return kept[i];
  });
  if (count.size !== kept.length || [...count.values()].some((n) => n !== 1)) {
    throw new Error('AI가 글 속 코드나 링크를 바꿔서 저장하지 않았어요. 다시 해 주세요.');
  }
  return out;
}

// 본문 말투 바꾸기. tone: first | third | mine (mine은 profile에 사용자 말투 설명)
export async function rewriteTone(apiKey, body, tone, profile) {
  const target =
    tone === 'mine' ? `글쓴이 본인의 말투. 아래는 글쓴이가 GitHub에 쓴 글을 보고 정리한 말투 설명이다.\n${profile}`
    : Object.hasOwn(TONES, tone) ? TONES[tone] : null; // toString 같은 이름이 말투로 통과하지 않게
  if (!target) throw stop('말투 설정이 이상해요.');
  const { text, kept } = protect(body);
  const system = [
    '너는 한국어 블로그 글의 말투만 바꾸는 편집자다.',
    '내용, 사실, 순서, 마크다운 구조(제목 #, 목록, 표, 인용, 빈 줄)는 그대로 두고 문장의 시점과 어미만 바꾼다.',
    '⟦숫자⟧ 자리표시자는 글자 하나 바꾸지 말고 같은 자리에 그대로 둔다.',
    '설명이나 머리말 없이 바꾼 글만 출력한다.',
    `\n바꿀 말투: ${target}`,
  ].join('\n');
  return restore(await ask(apiKey, system, text), kept);
}

// 사용자가 GitHub에 쓴 마크다운 글들로 말투 설명을 만든다
export const describeStyle = (apiKey, samples) =>
  ask(
    apiKey,
    [
      '다음은 한 사람이 GitHub에 마크다운으로 정리한 글들이다.',
      '이 사람의 글쓰기 말투를 다른 글에 그대로 따라 쓸 수 있게 설명해라:',
      '존댓말/반말, 문장 어미, 문장 길이, 자주 쓰는 표현, 설명하는 방식, 제목·목록을 쓰는 습관.',
      '글 내용은 요약하지 말고 말투만 15줄 안으로 쓴다.',
    ].join('\n'),
    samples.map((s, i) => `--- 글 ${i + 1} ---\n${s}`).join('\n\n'),
  );
