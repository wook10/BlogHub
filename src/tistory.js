// 백그라운드에서 쓰는 티스토리 읽기. (티스토리 페이지 안의 요청 형식은 tistory-hook.js에 있다)
// 공식 API가 없어서, 글 수정 화면(/manage/newpost/번호)에 들어 있는 글 정보(post: {...})를 읽는다.

const PUBLIC = 20; // 티스토리 공개 범위: 0 비공개, 15 보호(비밀번호), 20 공개

// 블로그 주소(https://아이디.tistory.com)만 받는다. 다른 주소로 로그인 쿠키를 보내지 않게.
export function blogOrigin(url) {
  const { protocol, hostname, origin } = new URL(url);
  if (protocol !== 'https:' || !/^[a-z0-9-]+\.tistory\.com$/.test(hostname) || hostname === 'www.tistory.com') {
    throw new Error('티스토리 블로그 주소가 아니에요');
  }
  return origin;
}

// 팝업에 넣은 블로그 아이디나 주소(아이디.tistory.com, https://아이디.tistory.com/...)로 블로그 주소
export const originOf = (input) => {
  const host = String(input).trim().toLowerCase().replace(/^https?:\/\//, '').split(/[/?#:]/)[0];
  return blogOrigin(`https://${host.replace(/\.tistory\.com$/, '')}.tistory.com/`);
};

const LOGIN = '이 브라우저에서 티스토리에 로그인한 뒤 다시 해 주세요.';

// 관리 화면 요청. 실패하면 고칠 수 있게 원인(연결, 없는 블로그, 로그인 안 됨, 남의 블로그)을 알려 주는 오류를 낸다.
async function manageGet(origin, path) {
  const res = await fetch(origin + path, { credentials: 'include' }).catch(() => {
    throw new Error('티스토리에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.');
  });
  if (res.status === 404) throw new Error(`${new URL(origin).host} 블로그를 찾지 못했어요. 블로그 주소를 확인해 주세요.`);
  if (new URL(res.url).origin !== origin) throw new Error(LOGIN); // 로그인 화면(www.tistory.com)으로 넘어감
  if (res.status === 403) throw new Error('내 블로그가 아니에요. 이 블로그 주인 계정으로 티스토리에 로그인해 주세요.');
  if (!res.ok) throw new Error(`티스토리 서버 오류 (${res.status})`);
  return res;
}

// 과거 글 가져오기: 글 관리 목록(/manage/posts.json)에서 글 번호와 제목을 모두 모은다 (최신 글부터).
// 관리 화면이라 블로그 주인으로 로그인돼 있어야 한다. 비공개 글도 들어 있다.
export async function listPosts(origin, onPage) {
  const posts = new Map();
  for (let page = 1; page <= 1000; page++) {
    const query = `category=-3&page=${page}&searchKeyword=&searchType=title&visibility=all`; // 관리 화면이 쓰는 값 그대로
    const res = await manageGet(origin, `/manage/posts.json?${query}`);
    const data = await res.json().catch(() => null);
    if (!Array.isArray(data?.items)) throw new Error('티스토리 글 목록을 읽지 못했어요 (티스토리가 바뀌었을 수 있어요)');
    for (const item of data.items) {
      const id = String(item.id);
      if (!/^\d+$/.test(id)) continue;
      // 저장할 때(normalize)와 같은 규칙: 확실히 공개(20)일 때만 공개, 모르는 값은 비공개로 본다 (공개 저장소에 새지 않게)
      posts.set(id, { id, title: String(item.title ?? ''), isPrivate: Math.abs(Number(item.visibility)) !== PUBLIC });
    }
    await onPage?.(posts.size);
    if (!data.items.length || posts.size >= data.totalCount) break;
  }
  return [...posts.values()];
}

// 수정 화면 HTML에서 post: {...} 한 줄을 꺼낸다.
// 지워진 글은 티스토리가 "삭제된 글입니다" 알림만 있는 짧은 페이지를 준다 → null.
// 그 밖에 알아볼 수 없는 화면은 오류: 지워진 것으로 착각해 GitHub 백업을 지우지 않게.
export function parsePostPage(html) {
  const post = configValue(html, 'post');
  if (post) return post;
  if (/alert\([^)]*삭제된 글/.test(html)) return null;
  throw new Error('티스토리 글 화면을 읽지 못했어요 (티스토리가 바뀌었을 수 있어요)');
}

// window.Config = { ... } 블록 안의 "이름: {...}" 한 줄 (페이지 다른 곳의 같은 이름을 잘못 읽지 않게). 없으면 undefined.
function configValue(html, key) {
  const lines = html.split('\n');
  const start = lines.findIndex((l) => /^\s*window\.Config\s*=\s*\{\s*$/.test(l));
  const end = start < 0 ? -1 : lines.findIndex((l, i) => i > start && /^\s*\};?\s*$/.test(l));
  const line = end < 0 ? null : lines.slice(start + 1, end).find((l) => new RegExp(`^\\s{0,8}${key}:\\s*\\{`).test(l));
  return line ? JSON.parse(line.replace(new RegExp(`^\\s*${key}:\\s*`), '').replace(/,\s*$/, '')) : undefined;
}

// 글의 카테고리 이름 (블로그 정보 Config.blog.categories에서 번호로 찾는다). 못 찾으면 null → 폴더 없이 저장.
// shortcut: 카테고리 정보의 모양을 실제 화면에서 확인하지 못해 id·name/label 이름과 children 하위 분류만 본다, 다른 모양이면 여기를 고치자.
export function categoryName(html, categoryId) {
  if (!Number(categoryId)) return null; // 0이나 빈 값은 분류 없음
  let blog;
  try {
    blog = configValue(html, 'blog');
  } catch {
    return null; // 블로그 정보를 못 읽어도 글은 저장한다
  }
  const find = (nodes) => {
    for (const node of Array.isArray(nodes) ? nodes : []) {
      if (String(node?.id) === String(categoryId)) return node;
      const child = find(node?.children);
      if (child) return child;
    }
    return null;
  };
  const node = find(blog?.categories);
  const name = node?.name ?? node?.label;
  return typeof name === 'string' && name.trim() ? name.trim() : null;
}

// 글 하나. 지워졌으면 null. 로그인이 풀렸으면 오류 (지워진 것으로 착각해 GitHub에서 지우지 않게).
// toMarkdown: HTML을 마크다운으로 바꾸는 함수 (서비스 워커에는 DOM이 없어서 화면 없는 페이지에 맡긴다).
// 없으면 본문은 바꾸지 않는다 (글이 있는지만 볼 때).
export async function fetchPost(origin, id, toMarkdown) {
  if (!/^\d+$/.test(id)) throw new Error('티스토리 글 번호가 이상해요');
  const res = await manageGet(origin, `/manage/newpost/${id}?type=post`);
  // 블로그 안의 다른 화면으로 넘어가도 글을 읽지 못한 것 (지워진 것으로 착각해 백업을 지우지 않게 오류)
  if (new URL(res.url).pathname !== `/manage/newpost/${id}`) throw new Error(LOGIN);
  const html = await res.text();
  const raw = parsePostPage(html);
  if (!raw) return null;
  const post = { ...normalize(raw, origin), category: categoryName(html, raw.category) }; // 정보가 이상하면 변환 전에 멈춘다
  if (!toMarkdown) return post;
  return { ...post, body: unescapeImgSrc(await toMarkdown(imagesToHtml(raw.content ?? ''))).trim() };
}

// 머리줄 없는 표처럼 마크다운으로 못 바꾼 부분은 HTML 그대로 남는데, 그 속 이미지 주소의 &는 &amp;로 적힌다.
// 그대로면 백업할 때 주소가 틀어지므로 <img src="..."> 안의 & 표기만 푼다. 코드 블록(```) 속 예제는 건드리지 않는다.
const AMP = /&(?:amp|#38|#x26);/gi;
const IMG_SRC = /(<img\b[^>]*?\ssrc=)(["'])(.*?)\2/gi;
const CODE_BLOCK = /(^`{3,}[^\n]*\n[\s\S]*?^`{3,}[ \t]*$)/m;
export const unescapeImgSrc = (md) =>
  md
    .split(CODE_BLOCK)
    .map((part, i) => (i % 2 ? part : part.replace(IMG_SRC, (_, before, q, url) => before + q + url.replace(AMP, '&') + q)))
    .join('');

// 저장에 쓰는 모양 (velog.js의 normalize와 같은 모양). 본문은 fetchPost가 마크다운으로 바꿔 채운다.
export function normalize(p, origin) {
  const seconds = Number(p?.orgPublished);
  const id = String(p?.id ?? '');
  if (!/^\d+$/.test(id) || typeof p.title !== 'string' || !seconds) {
    throw new Error(`글 정보가 이상해요: ${p?.title ?? p?.id}`);
  }
  return {
    id,
    title: p.title,
    body: '',
    tags: Array.isArray(p.tags) ? p.tags : String(p.tags ?? '').split(',').map((t) => t.trim()).filter(Boolean),
    is_private: Math.abs(Number(p.visibility)) !== PUBLIC,
    is_temp: false, // 임시저장은 다른 주소(/manage/drafts)라 여기로 오지 않는다
    // 파일 이름에 쓰는 글 주소. 같은 제목의 글이 겹치지 않게 글 번호를 붙인다.
    url_slug: `${p.slogan || 'post'}-${id}`,
    released_at: new Date(seconds * 1000).toISOString(),
    series: null, // 티스토리에는 시리즈가 없다. 카테고리는 fetchPost가 category로 채운다.
    source: 'tistory',
    url: `${origin}/${id}`,
  };
}

// ---- 이미지 자리표시자 ----
// 티스토리 본문의 이미지는 [##_Image|kage@키/파일|...|_##] 같은 자리표시자로 들어 있다.
// 마크다운으로 바꾸기 전에 <img>로 바꿔 두면 변환기가 ![](주소)로 만들어 준다.
const KAGE = /kage@([^|,\s"]+)/g;
// 자리표시자 전체에서 이미지를 찾는다 (갤러리는 이미지마다 칸이 따로 있다)
const PLACEHOLDER = /\[##_(?:Image|ImageGrid|Gallery)\|[\s\S]*?_##\]/g;
// 요즘 올린 이미지는 서명(?credential=...&signature=...)이 붙어 /dna/ 주소로만 열리고, 예전 이미지는 /dn/ 주소다.
// 서명은 그달 말까지 유효하고 글을 읽을 때마다 새로 붙는다(2026-11 확인).
export const SIGNED_IMAGE = /[?&]credential=/;
const imageUrl = (key) => `https://blog.kakaocdn.net/${SIGNED_IMAGE.test(key) ? 'dna' : 'dn'}/${key}`;
// 키는 본문에 적힌 그대로 넣는다 (&amp; 같은 표기는 HTML을 읽을 때 한 번 풀린다).
// 태그나 마크다운 링크 ![](주소)를 깨는 글자(따옴표, 괄호, < >)는 주소 표기(%22 등)로 바꾼다.
// (encodeURIComponent는 괄호를 바꾸지 않아 직접 바꾼다)
const percent = (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`;
export const imagesToHtml = (html) =>
  html.replace(PLACEHOLDER, (whole) =>
    [...whole.matchAll(KAGE)].map(([, key]) => `<img src="${imageUrl(key).replace(/["()<>]/g, percent)}">`).join(''),
  );
