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

// 블로그 아이디(아이디.tistory.com의 아이디)로 블로그 주소
export const originOf = (id) => blogOrigin(`https://${String(id).trim().toLowerCase()}.tistory.com/`);

// 과거 글 가져오기: 글 관리 목록(/manage/posts.json)에서 글 번호를 모두 모은다.
// 관리 화면이라 블로그 주인으로 로그인돼 있어야 한다. 비공개 글도 들어 있다.
export async function listPostIds(origin, onPage) {
  const ids = new Set();
  for (let page = 1; page <= 1000; page++) {
    const query = `category=-3&page=${page}&searchKeyword=&searchType=title&visibility=all`; // 관리 화면이 쓰는 값 그대로
    const res = await fetch(`${origin}/manage/posts.json?${query}`, { credentials: 'include' });
    if (!res.ok) throw new Error(`티스토리 서버 오류 (${res.status})`);
    const data = await res.json().catch(() => null); // 로그인 화면(HTML)으로 넘어가면 JSON이 아니다
    if (!Array.isArray(data?.items)) {
      throw new Error('티스토리 글 목록을 읽지 못했어요. 내 블로그 아이디인지, 티스토리에 로그인돼 있는지 확인해 주세요.');
    }
    for (const item of data.items) if (/^\d+$/.test(String(item.id))) ids.add(String(item.id));
    await onPage?.(ids.size);
    if (!data.items.length || ids.size >= data.totalCount) break;
  }
  return [...ids];
}

// 수정 화면 HTML에서 post: {...} 한 줄을 꺼낸다.
// 지워진 글은 티스토리가 "삭제된 글입니다" 알림만 있는 짧은 페이지를 준다 → null.
// 그 밖에 알아볼 수 없는 화면은 오류: 지워진 것으로 착각해 GitHub 백업을 지우지 않게.
export function parsePostPage(html) {
  // window.Config = { ... } 블록 안의 post 줄만 본다 (페이지 다른 곳의 post: 를 잘못 읽지 않게)
  const lines = html.split('\n');
  const start = lines.findIndex((l) => /^\s*window\.Config\s*=\s*\{\s*$/.test(l));
  const end = start < 0 ? -1 : lines.findIndex((l, i) => i > start && /^\s*\};?\s*$/.test(l));
  const line = end < 0 ? null : lines.slice(start + 1, end).find((l) => /^\s{0,8}post:\s*\{/.test(l));
  if (line) return JSON.parse(line.replace(/^\s*post:\s*/, '').replace(/,\s*$/, ''));
  if (/alert\([^)]*삭제된 글/.test(html)) return null;
  throw new Error('티스토리 글 화면을 읽지 못했어요 (티스토리가 바뀌었을 수 있어요)');
}

// 글 하나. 지워졌으면 null. 로그인이 풀렸으면 오류 (지워진 것으로 착각해 GitHub에서 지우지 않게).
export async function fetchPost(origin, id) {
  if (!/^\d+$/.test(id)) throw new Error('티스토리 글 번호가 이상해요');
  const res = await fetch(`${origin}/manage/newpost/${id}?type=post`, { credentials: 'include' });
  if (!res.ok) throw new Error(`티스토리 서버 오류 (${res.status})`);
  if (new URL(res.url).pathname !== `/manage/newpost/${id}`) {
    throw new Error('티스토리에 로그인돼 있는지 확인해 주세요.');
  }
  const raw = parsePostPage(await res.text());
  return raw ? normalize(raw, origin) : null;
}

// 저장에 쓰는 모양 (velog.js의 normalize와 같은 모양)
export function normalize(p, origin) {
  const seconds = Number(p?.orgPublished);
  const id = String(p?.id ?? '');
  if (!/^\d+$/.test(id) || typeof p.title !== 'string' || !seconds) {
    throw new Error(`글 정보가 이상해요: ${p?.title ?? p?.id}`);
  }
  return {
    id,
    title: p.title,
    body: htmlToMarkdown(p.content ?? ''),
    tags: Array.isArray(p.tags) ? p.tags : String(p.tags ?? '').split(',').map((t) => t.trim()).filter(Boolean),
    is_private: Math.abs(Number(p.visibility)) !== PUBLIC,
    is_temp: false, // 임시저장은 다른 주소(/manage/drafts)라 여기로 오지 않는다
    // 파일 이름에 쓰는 글 주소. 같은 제목의 글이 겹치지 않게 글 번호를 붙인다.
    url_slug: `${p.slogan || 'post'}-${id}`,
    released_at: new Date(seconds * 1000).toISOString(),
    series: null, // shortcut: 카테고리는 아직 폴더로 나누지 않는다. 쓰는 사람이 원하면 Config.blog.categories로 이름을 찾자.
    source: 'tistory',
    url: `${origin}/${id}`,
  };
}

// ---- HTML → 마크다운 ----
// 서비스 워커에는 DOMParser가 없어서 태그를 직접 읽는다.
// shortcut: 티스토리 편집기가 만드는 흔한 태그만 바꾸고, 표는 HTML 그대로 둔다(GitHub에서 표로 보인다).
// 본문 글자 속 *, _ 같은 마크다운 기호는 이스케이프하지 않는다. 깨지는 글이 나오면 그때 추가하자.

const VOID = new Set(['br', 'img', 'hr', 'input', 'meta', 'col', 'wbr', 'source']);
const BLOCK = new Set(['p', 'div', 'section', 'figure', 'figcaption', 'article', 'header', 'footer']);

const decode = (s) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (whole, e) => {
    if (e[0] !== '#') return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }[e.toLowerCase()];
    try {
      return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1));
    } catch {
      return whole; // 잘못된 번호 하나 때문에 글 전체를 버리지 않는다
    }
  });

const attr = (attrs, name) => {
  const m = attrs.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return m ? decode(m[1] ?? m[2] ?? m[3]) : '';
};

// 이미지 자리표시자 [##_Image|kage@키/파일|...|_##]를 실제 이미지 주소로 바꾼다
const KAGE = /kage@([^|,\s"]+)/g;
// 자리표시자 전체에서 이미지를 찾는다 (갤러리는 이미지마다 칸이 따로 있다)
const PLACEHOLDER = /\[##_(?:Image|ImageGrid|Gallery)\|[\s\S]*?_##\]/g;
const placeholders = (html) =>
  html.replace(PLACEHOLDER, (whole) =>
    [...whole.matchAll(KAGE)].map(([, key]) => `<img src="https://blog.kakaocdn.net/dn/${key}">`).join(''),
  );

// 태그를 나무 모양으로 묶는다. 닫는 태그가 어긋나면 맞는 것까지 닫고, 없는 태그는 무시한다.
function parse(html) {
  const root = { tag: '', children: [] };
  const stack = [root];
  const re = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*)>|([^<]+|<)/g;
  for (let m; (m = re.exec(html)); ) {
    const [whole, closing, rawTag, attrs = '', text] = m;
    const top = stack.at(-1);
    if (text !== undefined) top.children.push(decode(text));
    else if (!rawTag) continue; // 주석
    else if (closing) {
      const i = stack.findLastIndex((n) => n.tag === rawTag.toLowerCase());
      if (i > 0) {
        stack[i].end = m.index + whole.length;
        stack.length = i;
      }
    } else {
      const node = { tag: rawTag.toLowerCase(), attrs, children: [], start: m.index };
      top.children.push(node);
      if (!VOID.has(node.tag) && !attrs.trim().endsWith('/')) stack.push(node);
    }
  }
  return root;
}

const textOf = (node) =>
  typeof node === 'string' ? node : node.tag === 'br' ? '\n' : node.children.map(textOf).join('');

function render(node, html) {
  // 글자로 쓴 <div>, &lt; 같은 것이 마크다운에서 태그나 문자로 바뀌지 않게 다시 감싼다
  if (typeof node === 'string') {
    return node.replace(/\s+/g, ' ').replace(/&(?=#?\w+;)/g, '&amp;').replace(/</g, '&lt;');
  }
  const inner = () => node.children.map((c) => render(c, html)).join('');
  const block = (s) => (s.trim() ? `\n\n${s.trim()}\n\n` : '\n\n');
  const wrap = (mark) => {
    const s = inner();
    return s.trim() ? `${mark}${s.trim()}${mark}` : s;
  };
  const { tag, attrs } = node;
  if (/^h[1-6]$/.test(tag)) return block(`${'#'.repeat(+tag[1])} ${inner().trim()}`);
  if (BLOCK.has(tag)) return block(inner());
  switch (tag) {
    case 'br':
      return '  \n';
    case 'hr':
      return '\n\n---\n\n';
    case 'strong':
    case 'b':
      return wrap('**');
    case 'em':
    case 'i':
      return wrap('*');
    case 's':
    case 'strike':
    case 'del':
      return wrap('~~');
    case 'code': {
      // 코드 속 ` 보다 긴 ` 묶음으로 감싼다 (a`b → ``a`b``)
      const code = textOf(node);
      const ticks = '`'.repeat(Math.max(0, ...(code.match(/`+/g) ?? []).map((t) => t.length)) + 1);
      return ticks.length > 1 ? `${ticks} ${code} ${ticks}` : `\`${code}\``;
    }
    case 'a': {
      const href = attr(attrs, 'href');
      return href ? `[${inner().trim()}](${href})` : inner();
    }
    case 'img': {
      const src = attr(attrs, 'src');
      return src ? `![${attr(attrs, 'alt')}](${src})` : '';
    }
    case 'pre': {
      const lang = attr(attrs, 'data-ke-language') || attr(attrs, 'class').split(/\s+/)[0];
      return `\n\n\`\`\`${lang}\n${textOf(node).replace(/\n$/, '')}\n\`\`\`\n\n`;
    }
    case 'blockquote':
      return block(inner().trim().split('\n').map((l) => `> ${l}`.trimEnd()).join('\n'));
    case 'ul':
    case 'ol': {
      let n = 0;
      const items = node.children
        .filter((c) => typeof c !== 'string')
        .map((li) => {
          const marker = tag === 'ol' ? `${++n}.` : '-';
          const text = render({ ...li, tag: li.tag === 'li' ? 'span' : li.tag }, html).trim().replace(/\n{2,}/g, '\n');
          return `${marker} ${text.replace(/\n/g, `\n${' '.repeat(marker.length + 1)}`)}`;
        });
      return `\n\n${items.join('\n')}\n\n`;
    }
    case 'table':
      return node.end ? block(html.slice(node.start, node.end)) : inner();
    case 'script':
    case 'style':
      return '';
    default:
      return inner();
  }
}

export function htmlToMarkdown(content) {
  const html = placeholders(content);
  // 빈 줄 정리는 코드 블록 바깥에서만 한다 (코드 속 빈 줄은 그대로)
  return render(parse(html), html)
    .split(/(```[^\n]*\n[\s\S]*?\n```)/)
    .map((part, i) =>
      i % 2
        ? part
        : part
            .split('\n')
            .map((l) => (l.trim() ? l : ''))
            .join('\n')
            .replace(/\n{3,}/g, '\n\n'),
    )
    .join('')
    .trim();
}
