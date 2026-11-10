// 과거 글을 가져올 때 AI(Google Gemini)로 말투를 바꾼다.
// BlogHub에는 서버가 없어서, 사용자가 설정에 넣은 Gemini API 키로 이 브라우저에서 바로 부른다.
// SDK 대신 fetch를 쓰는 이유: 이 확장은 빌드 단계 없이 파일을 그대로 싣는다 (SDK를 넣으려면 번들러가 필요).

const API = 'https://generativelanguage.googleapis.com/v1beta/models';
const MODEL = 'gemini-3.5-flash-lite'; // 무료로 쓸 수 있는 모델 (무료 구간에는 분당·하루 요청 한도가 있다)
const RETRIES = 3; // 분당 한도나 서버가 바쁠 때 기다렸다 다시 해 보는 횟수
const RETRY_STATUSES = [429, 500, 503]; // 분당 한도, 서버 오류, 서버가 바쁨
const DEFAULT_WAIT_S = 15; // 구글이 기다릴 시간을 안 알려 주면
const MAX_WAIT_S = 70; // 한 번에 이보다 오래 기다리지 않는다 (분당 한도는 1분이면 풀린다)
const MAX_OUTPUT_TOKENS = 32000; // shortcut: 이보다 긴 글은 "너무 길어" 오류로 건너뛴다, 필요하면 모델 한도 안에서 올리자
// 말투 분석 결과의 판. 올리면 예전 결과를 버리고 다시 분석한다 (v2: 공개 저장소만 본 결과)
export const PROFILE_VERSION = 2;
const REFUSED = 'AI가 이 글의 말투 바꾸기를 거절했어요.';

export const TONES = {
  first: '1인칭 시점. 글쓴이가 "나는", "내가"로 자기 경험과 생각을 말하는 평서체(~했다, ~이다)로 쓴다.',
  third: '3인칭 설명체. 글쓴이를 드러내지 않고 대상을 객관적으로 설명하는 평서체(~이다, ~한다)로 쓴다. "나", "저" 같은 1인칭 표현은 쓰지 않는다.',
};

// 글 하나의 문제가 아니라 모든 글에서 똑같이 실패할 오류 (키, 연결, 하루 한도). 가져오기를 바로 멈춘다.
export const stop = (message) => Object.assign(new Error(message), { stopAll: true });

// 테스트에서 기다리는 시간을 줄일 수 있게 객체에 둔다
export const retry = { wait: (ms) => new Promise((r) => setTimeout(r, ms)) };

// 오류 응답의 "17s" 같은 권장 대기 시간 (초). 없으면 null.
const retryDelay = (error) => {
  const info = (error?.details ?? []).find((d) => String(d['@type']).endsWith('RetryInfo'));
  const seconds = parseFloat(info?.retryDelay);
  return Number.isFinite(seconds) ? seconds : null;
};

// onWait(초): 한도 때문에 기다릴 때 알려 준다 (화면이 멈춘 것처럼 보이지 않게)
async function ask(apiKey, system, text, onWait) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${API}/${MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      signal: AbortSignal.timeout(5 * 60_000), // 응답이 끝없이 늦어 가져오기가 멈추지 않게
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text }] }],
        generationConfig: { maxOutputTokens: MAX_OUTPUT_TOKENS }, // 생각하는 데 쓰는 몫도 이 안에 든다
      }),
    }).catch((e) => {
      // 시간 초과는 그 글이 길어서일 수 있어 그 글만 건너뛰고, 연결이 끊긴 건 모든 글이 같으니 멈춘다
      if (e.name === 'TimeoutError') throw new Error('AI 응답이 너무 늦어 이 글은 건너뛰었어요.');
      throw stop('Google AI에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.');
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const error = data.error ?? {};
      const info = `${error.message ?? ''} ${JSON.stringify(error.details ?? [])}`; // 하루 한도 표시가 어디에 있든 찾는다
      if (/API_KEY_INVALID/.test(info) || res.status === 401 || res.status === 403) {
        throw stop('Gemini API 키가 맞지 않아요. ⚙ 설정에서 확인해 주세요.');
      }
      if (res.status === 429 && /PerDay|per day|daily/i.test(info)) {
        throw stop('오늘 쓸 수 있는 무료 한도를 다 썼어요. 내일 다시 하거나 나머지는 하나씩 가져와 주세요.');
      }
      // 모델이 없어졌거나 이 지역에서 무료로 못 쓰면 모든 글이 똑같이 실패한다
      if (res.status === 404 || error.status === 'FAILED_PRECONDITION') {
        throw stop(`지금은 이 AI를 쓸 수 없어요 (${error.message ?? res.status}). BlogHub를 업데이트하거나 나중에 다시 해 주세요.`);
      }
      // 분당 한도(429)와 서버가 바쁠 때(500·503)는 잠깐 기다렸다 다시 한다
      if (RETRY_STATUSES.includes(res.status) && attempt < RETRIES) {
        const seconds = Math.min((retryDelay(error) ?? DEFAULT_WAIT_S) + 1, MAX_WAIT_S);
        onWait?.(Math.ceil(seconds));
        await retry.wait(seconds * 1000);
        continue;
      }
      if (res.status === 429) throw stop('AI 요청이 너무 많아요. 잠시 뒤에 다시 해 주세요.');
      throw new Error(`AI 오류 (${res.status}): ${error.message ?? '알 수 없는 오류'}`);
    }
    if (data.promptFeedback?.blockReason) throw new Error(REFUSED);
    const candidate = data.candidates?.[0];
    if (candidate?.finishReason === 'MAX_TOKENS') throw new Error('글이 너무 길어 말투를 바꾸지 못했어요.');
    if (candidate?.finishReason && candidate.finishReason !== 'STOP') throw new Error(REFUSED);
    const out = (candidate?.content?.parts ?? []).filter((p) => p.text && !p.thought).map((p) => p.text).join('').trim();
    if (!out) throw new Error('AI가 빈 글을 돌려줬어요. 다시 해 주세요.');
    return out;
  }
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
export async function rewriteTone(apiKey, body, tone, profile, onWait) {
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
  return restore(await ask(apiKey, system, text, onWait), kept);
}

// 사용자가 GitHub에 쓴 마크다운 글들로 말투 설명을 만든다
export const describeStyle = (apiKey, samples, onWait) =>
  ask(
    apiKey,
    [
      '다음은 한 사람이 GitHub에 마크다운으로 정리한 글들이다.',
      '이 사람의 글쓰기 말투를 다른 글에 그대로 따라 쓸 수 있게 설명해라:',
      '존댓말/반말, 문장 어미, 문장 길이, 자주 쓰는 표현, 설명하는 방식, 제목·목록을 쓰는 습관.',
      '글 내용은 요약하지 말고 말투만 15줄 안으로 쓴다.',
    ].join('\n'),
    samples.map((s, i) => `--- 글 ${i + 1} ---\n${s}`).join('\n\n'),
    onWait,
  );
