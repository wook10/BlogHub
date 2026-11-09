import { requestDeviceCode, pollToken, getUser, listRepos, createRepo, commitFiles, listFiles, readBlob } from './github.js';
import {
  toMarkdown, filePath, findImages, replaceImages, imageDir, imageName, relativeLink,
  sourceLine, indexPostFiles, candidateFiles,
} from './markdown.js';
import { fetchPost, fetchAllPosts, normalize } from './velog.js';
import * as tistory from './tistory.js';

const store = chrome.storage.local;

// 블로그마다 다른 부분.
// key: 저장소에 저장한 파일을 기억하는 이름 (티스토리 글 번호는 블로그마다 1부터라 블로그 주소를 붙인다)
// importId: 팝업의 "과거 글 가져오기" 칸에 미리 채울 아이디
const velogSource = { name: 'velog', fetchPost, key: (id) => id, importId: (post) => post.username };

// 티스토리 HTML → 마크다운. 서비스 워커에는 DOM이 없어서 화면 없는 페이지(offscreen)에서
// 티스토리 편집기와 같은 turndown 설정으로 바꾼다.
let creating = null; // 동시에 두 번 만들지 않게
async function openOffscreen() {
  const open = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (open.length) return;
  creating ??= chrome.offscreen
    .createDocument({ url: 'offscreen/offscreen.html', reasons: ['DOM_PARSER'], justification: 'Convert blog post HTML to Markdown' })
    .finally(() => (creating = null));
  await creating;
}

async function htmlToMarkdown(html) {
  const msg = { target: 'offscreen', type: 'html-to-markdown', html };
  await openOffscreen();
  const res = await chrome.runtime.sendMessage(msg).catch(async () => {
    await openOffscreen(); // 그사이 페이지가 닫혔으면 다시 열고 한 번 더
    return chrome.runtime.sendMessage(msg);
  });
  if (!res?.ok) throw new Error(`마크다운 변환 실패: ${res?.error ?? '응답 없음'}`);
  return res.data;
}

function tistorySource(origin) {
  const host = new URL(origin).hostname;
  return {
    name: 'tistory',
    fetchPost: (id) => tistory.fetchPost(origin, id, htmlToMarkdown),
    exists: async (id) => !!(await tistory.fetchPost(origin, id)), // 지울 때 확인용: 본문 변환은 하지 않는다
    key: (id) => `tistory:${host}:${id}`,
    importId: () => host.split('.')[0],
  };
}

// 메시지를 보낸 페이지로 어느 블로그인지 정한다
function sourceOf(url) {
  if (url?.startsWith('https://velog.io/')) return velogSource;
  const origin = url && new URL(url).pathname.startsWith('/manage/') ? tistory.blogOrigin(url) : null;
  if (!origin) throw new Error('velog나 티스토리 관리 화면에서 온 요청이 아니에요');
  return tistorySource(origin);
}

// 서비스 워커가 새로 떴다면 전에 하던 가져오기는 이미 멈춘 것이라 표시를 지운다
store.remove('importStatus');

// 오래 걸리는 작업 중에 서비스 워커가 잠들지 않게 20초마다 확장 API를 부른다
async function keepAlive(fn) {
  const timer = setInterval(() => chrome.runtime.getPlatformInfo(), 20_000);
  try {
    return await fn();
  } finally {
    clearInterval(timer);
  }
}

// 연결된 저장소, 설정, 그리고 그 저장소에 저장한 글 id → 파일 경로 기록
async function target(token) {
  const { repo, paths = {}, savePrivate = false, backupImages = true } = await store.get([
    'repo', 'paths', 'savePrivate', 'backupImages',
  ]);
  if (!token || !repo) throw new Error('BlogHub 팝업에서 로그인하고 저장소를 연결해 주세요.');
  const pathOf = (id) => paths[repo]?.[id];
  // { id: 경로 | null(잊기) }. 오래 걸린 작업 사이에 다른 글이 기록됐을 수 있어 최신 값에 합친다.
  const remember = async (changes) => {
    const { paths: latest = {} } = await store.get('paths');
    const saved = { ...latest[repo] };
    for (const [id, path] of Object.entries(changes)) {
      if (path) saved[id] = path;
      else delete saved[id];
    }
    await store.set({ paths: { ...latest, [repo]: saved } });
  };
  return { repo, savePrivate, backupImages, pathOf, remember };
}

// 글 하나를 커밋할 파일들로 만든다. 이미지를 백업하면 내려받아 링크를 저장소 경로로 바꾼다.
// 백업을 꺼도 티스토리 서명 주소의 이미지는 저장한다 (서명이 그달 말에 끝나 링크가 깨지므로).
// oldPath가 있으면 경로가 바뀐 예전 파일을 지우고, deleteDirs로 글에서 빠진 이미지를 정리한다.
async function postFiles(post, backupImages, oldPath) {
  const date = new Date(post.released_at).toLocaleDateString('sv-SE'); // YYYY-MM-DD, 내 컴퓨터 시간대
  const path = filePath(post, date);
  const files = {};
  const links = new Map();
  let imagesOk = true;
  const dir = imageDir(path);
  // 번호는 글 속 순서 그대로 쓴다 (설정을 바꿔도 같은 이미지가 같은 파일 이름이 되게)
  for (const [i, url] of findImages(post.body).entries()) {
    if (!backupImages && !tistory.SIGNED_IMAGE.test(url)) continue;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(res.status);
      const file = `${dir}/${imageName(url, i, res.headers.get('content-type') ?? '')}`;
      files[file] = new Uint8Array(await res.arrayBuffer());
      links.set(url, relativeLink(path, file));
    } catch {
      imagesOk = false; // 못 받은 이미지는 원래 블로그 링크를 그대로 둔다
    }
  }
  files[path] = toMarkdown({ ...post, body: replaceImages(post.body, links) }, date);
  if (oldPath && oldPath !== path) files[oldPath] = null;
  // 이미지를 하나라도 못 받았으면 예전 백업을 지우지 않는다 (잠깐의 오류로 백업을 잃지 않게)
  const deleteDirs = imagesOk ? [imageDir(path), ...(oldPath ? [imageDir(oldPath)] : [])] : [];
  return { path, files, deleteDirs };
}

// 글 파일과 그 글의 이미지 폴더를 지우는 커밋
const deletePost = (token, repo, path, message) =>
  commitFiles(token, repo, { files: { [path]: null }, deleteDirs: [imageDir(path)], message });

async function remove(id, token, source) {
  const { repo, pathOf, remember } = await target(token);
  const key = source.key(id);
  const oldPath = pathOf(key);
  if (!oldPath) return 'GitHub에 저장된 적 없는 글이라 지울 파일이 없어요.';
  // 가짜 삭제 요청으로 백업이 지워지지 않게, 블로그에서 정말 없어졌는지 확인한다
  if (await (source.exists ?? source.fetchPost)(id)) throw new Error(`${source.name}에 아직 있는 글이라 지우지 않았어요.`);
  await deletePost(token, repo, oldPath, `[${source.name}] 삭제: ${oldPath.split('/').pop()}`);
  await remember({ [key]: null });
  return 'GitHub에서도 지웠어요.';
}

// commit: false면 커밋은 하지 않고, 비공개로 바뀐 글을 저장소에서 지우는 일만 한다 ("발행하면 바로 저장"이 꺼졌을 때)
async function publish(id, token, source, { commit = true } = {}) {
  const { repo, savePrivate, backupImages, pathOf, remember } = await target(token);
  // 페이지가 보낸 내용은 믿지 않고 블로그 서버에서 글을 직접 받는다. 실패하면 추측하지 않고 멈춘다.
  const post = await source.fetchPost(id);
  if (!post) throw new Error(`${source.name}에서 글을 찾지 못했어요. 비공개 글이면 로그인돼 있는지 확인해 주세요.`);
  const done = (message) => ({ title: post.title, message });
  if (post.is_temp) return done('임시저장 글이라 저장하지 않았어요.');
  await store.set({ importBlog: source.name, importUser: source.importId(post) }); // 과거 글 가져오기 칸에 미리 채워 둔다
  const key = source.key(post.id);
  const oldPath = pathOf(key);

  if (post.is_private && !savePrivate) {
    if (!oldPath) return done('비공개 글이라 GitHub에 저장하지 않았어요.');
    // 저장했던 글을 비공개로 바꿨으면 저장소에서도 지운다
    await deletePost(token, repo, oldPath, `[${source.name}] ${post.title} 비공개 전환`);
    await remember({ [key]: null });
    return done('비공개로 바뀐 글이라 GitHub에서 지웠어요.');
  }
  if (!commit) {
    // 이미 저장된 글의 수정은 "목록 보고 하나씩"에 나오지 않으므로 다르게 안내한다
    return done(
      oldPath
        ? '자동 저장이 꺼져 있어 수정 내용을 저장하지 않았어요. 반영하려면 설정을 켜고 다시 저장해 주세요.'
        : '자동 저장이 꺼져 있어 저장하지 않았어요. 팝업의 "목록 보고 하나씩"에서 가져올 수 있어요.',
    );
  }

  const { path, files, deleteDirs } = await postFiles(post, backupImages, oldPath);
  const has = await commitFiles(token, repo, {
    files,
    deleteDirs,
    message: (has) => `[${source.name}] ${post.title}${has.has(path) || oldPath ? ' 수정' : ''}`,
  });
  await remember({ [key]: path });
  return { ...done(has.has(path) || oldPath ? 'GitHub에 수정 내용 저장됨' : 'GitHub에 저장됨'), saved: true };
}

// 이미지 메모리와 GitHub 요청이 한꺼번에 몰리지 않게 이만큼씩 나눠 커밋한다
const IMPORT_CHUNK = 10;

// 블로그 종류와 아이디로 어느 블로그인지 (팝업에서 온 요청)
const sourceFor = (blog, username) => (blog === 'tistory' ? tistorySource(tistory.originOf(username)) : velogSource);

// 과거 글 목록 (최신 글부터).
// load: 목록의 한 항목을 저장할 글로 바꾼다 (지워졌으면 null). velog는 목록에 글 내용까지 오고, 티스토리는 한 글씩 다시 읽는다.
// brief: 팝업 목록에 보여 줄 { id, title, isPrivate, isTemp }
async function postList(blog, username, onPage) {
  const source = sourceFor(blog, username);
  if (blog === 'tistory') {
    const origin = tistory.originOf(username);
    const items = await tistory.listPosts(origin, onPage);
    return {
      source,
      items,
      load: (item) => source.fetchPost(item.id),
      brief: (item) => ({ ...item, isTemp: false, line: sourceLine({ source: 'tistory', url: `${origin}/${item.id}` }) }),
    };
  }
  return {
    source,
    items: await fetchAllPosts(username, onPage),
    load: async (item) => normalize(item),
    // 정보가 빠져 저장할 수 없는 글은 목록에서 뺀다 (한 번에 가져오기도 건너뛰는 글)
    brief: (item) => {
      try {
        const p = normalize(item);
        return { id: p.id, slug: p.url_slug, line: sourceLine(p), title: p.title, isPrivate: p.is_private, isTemp: p.is_temp };
      } catch {
        return null;
      }
    },
  };
}

// 저장소에 아직 없는 과거 글 목록 (팝업에서 하나씩 골라 가져오기)
async function missingPosts(blog, username, token) {
  const { repo, pathOf, remember, savePrivate } = await target(token);
  const { source, items, brief } = await postList(blog, username);
  // 저장되지 않을 글(임시저장, 비공개인데 설정이 꺼짐)과 이 브라우저가 저장한 글은 목록에 보이지 않게 한다
  const posts = items
    .map(brief)
    .filter((p) => p && !p.isTemp && (savePrivate || !p.isPrivate) && !pathOf(source.key(String(p.id))));
  // 다른 브라우저에서 저장한 글도 뺀다. 찾은 경로는 기록해 둬서 나중에 수정·삭제할 때 같은 파일을 쓴다.
  const found = await findSaved(token, repo, posts);
  await remember(Object.fromEntries(Object.entries(found).map(([id, path]) => [source.key(id), path])));
  return posts.filter((p) => !found[p.id]);
}

// 이 브라우저에 기록은 없지만 저장소에 이미 파일이 있는 글 { 글 id: 경로 }.
// 파일 이름으로 후보를 고르고, 파일 속 글 주소 줄이 같은지 확인한다 (다른 블로그의 같은 번호 글과 헷갈리지 않게).
async function findSaved(token, repo, posts) {
  const files = await listFiles(token, repo).catch((e) => {
    console.warn('[BlogHub] 저장소 파일 목록을 못 읽어 이 브라우저 기록만 봐요', e);
    return []; // 빈 저장소(409) 등. 다시 가져와도 내용이 같으면 커밋이 생기지 않는다.
  });
  const index = indexPostFiles(files);
  const checks = posts.flatMap((p) => candidateFiles(index, { id: String(p.id), slug: p.slug }).map((file) => ({ p, file })));
  const found = {};
  for (let i = 0; i < checks.length; i += 10) {
    // GitHub에 한꺼번에 너무 많이 요청하지 않게 10개씩
    await Promise.all(
      checks.slice(i, i + 10).map(async ({ p, file }) => {
        const text = await readBlob(token, repo, file.sha).catch(() => '');
        if (text.split('\n').includes(p.line)) found[String(p.id)] = file.path;
      }),
    );
  }
  return found;
}

// 블로그에 쓴 글 전체를 가져온다
async function importAll(blog, username, token) {
  const { repo, savePrivate, backupImages, pathOf, remember } = await target(token);
  const status = (importStatus) => store.set({ importStatus });
  const { source, items, load } = await postList(blog, username, (n) => status(`글 목록 불러오는 중 (${n}개)`));
  let saved = 0;
  let broken = 0;
  let lastError = '';
  for (let start = 0; start < items.length; start += IMPORT_CHUNK) {
    const files = {};
    const deleteDirs = [];
    const paths = {};
    for (const [j, item] of items.slice(start, start + IMPORT_CHUNK).entries()) {
      await status(`글 준비 중 ${start + j + 1}/${items.length}`);
      let post;
      try {
        post = await load(item);
      } catch (e) {
        broken++; // 글 하나 때문에 전체를 멈추지 않는다. 이유는 마지막에 보여 준다.
        lastError = e.message;
        continue;
      }
      if (!post || post.is_temp || (post.is_private && !savePrivate)) continue;
      const key = source.key(post.id);
      const result = await postFiles(post, backupImages, pathOf(key));
      Object.assign(files, result.files);
      deleteDirs.push(...result.deleteDirs);
      paths[key] = result.path;
    }
    const count = Object.keys(paths).length;
    if (!count) continue;
    const end = Math.min(start + IMPORT_CHUNK, items.length);
    await status(`GitHub에 커밋하는 중 (${end}/${items.length})`);
    await commitFiles(token, repo, {
      files,
      deleteDirs,
      message: `[${source.name}] 과거 글 가져오기 (${start + 1}~${end})`,
    });
    await remember(paths); // 나눠 커밋하므로 중간에 멈춰도 여기까지는 저장된다
    saved += count;
  }
  const skipped = broken ? ` (못 읽은 글 ${broken}개는 건너뜀: ${lastError})` : '';
  if (!saved) return `가져올 글이 없어요.${skipped}`;
  return `과거 글 ${saved}개를 GitHub에 저장했어요.${skipped}`;
}

async function waitForLogin({ device_code, user_code, interval }) {
  // 그사이 로그아웃했거나 로그인을 새로 시작했으면 이 결과는 버린다
  const stillWaiting = async () => (await store.get('pending')).pending?.userCode === user_code;
  try {
    // 확장 API를 부르면 서비스 워커가 잠들지 않으므로, 기다리는 동안 매번 storage를 건드린다.
    const token = await pollToken(device_code, interval, { onTick: () => store.get('pending') });
    const user = await getUser(token);
    if (await stillWaiting()) await store.set({ token, user: user.login });
  } catch (e) {
    if (await stillWaiting()) await store.set({ authError: e.message });
  } finally {
    if (await stillWaiting()) await store.remove('pending');
  }
}

// 마지막 결과를 남겨서 팝업에서 보여 준다. fn은 메시지나 { title, message }를 돌려준다.
async function record(title, fn) {
  const time = Date.now();
  try {
    const result = await fn();
    const { title: t = title, message } = typeof result === 'string' ? { message: result } : result;
    await store.set({ lastSync: { time, title: t, ok: true, message } });
    return message;
  } catch (e) {
    console.error('[BlogHub] 실패', e);
    await store.set({ lastSync: { time, title, ok: false, message: e.message } });
    throw e;
  }
}

// 과거 글 가져오기 요청의 블로그 종류와 아이디 확인
function checkImportTarget(msg) {
  if (msg.blog !== 'velog' && msg.blog !== 'tistory') throw new Error('블로그 종류를 골라 주세요.');
  if (typeof msg.username !== 'string' || !msg.username.trim()) throw new Error('블로그 아이디를 입력해 주세요.');
  if (msg.blog === 'tistory') tistory.originOf(msg.username); // 이상한 아이디는 시작 전에 알린다
}

let importing = false; // 서비스 워커 안에서 하나만 돌게 (storage 확인은 동시에 두 번 통과할 수 있음)

async function handle(msg, sender) {
  const { token } = await store.get('token');
  switch (msg.type) {
    case 'publish':
    case 'remove': {
      const source = sourceOf(sender.url);
      const removing = msg.type === 'remove';
      // "발행하면 바로 저장"을 끄면 발행·수정은 커밋하지 않는다 (나중에 "목록 보고 하나씩"으로 고른다).
      // 그래도 블로그에서 지운 글과 비공개로 바꾼 글은 저장소에서 지운다 (공개 저장소에 남지 않게).
      const { autoSave = true } = await store.get('autoSave');
      return record(removing ? '삭제한 글' : '출간한 글', () => {
        if (msg.error) throw new Error(`${removing ? '삭제' : '출간'} 감지 중 오류: ${msg.error}`);
        if (typeof msg.id !== 'string' || !msg.id) throw new Error(`글 id가 없어요 (${source.name}가 바뀌었을 수 있어요)`);
        return keepAlive(() => (removing ? remove(msg.id, token, source) : publish(msg.id, token, source, { commit: autoSave })));
      });
    }
    case 'import': {
      checkImportTarget(msg);
      if (importing) throw new Error('이미 가져오는 중이에요.');
      importing = true;
      await store.set({ importStatus: '시작하는 중' });
      // 오래 걸리니 팝업에는 바로 답하고, 진행 상황은 importStatus로 보여 준다
      record('과거 글 가져오기', () => keepAlive(() => importAll(msg.blog, msg.username.trim(), token)))
        .catch(() => {})
        .finally(() => {
          importing = false;
          store.remove('importStatus');
        });
      return null;
    }
    case 'missingPosts':
      checkImportTarget(msg);
      return keepAlive(() => missingPosts(msg.blog, msg.username.trim(), token));
    case 'importOne': {
      checkImportTarget(msg);
      if (typeof msg.id !== 'string' || !msg.id) throw new Error('글을 골라 주세요.');
      // 한 번에 가져오기가 도는 중에는 받지 않는다 (같은 글을 두 번 커밋하지 않게)
      if (importing) throw new Error('다른 가져오기가 끝난 뒤에 해 주세요.');
      importing = true;
      await store.set({ importStatus: '글 하나 가져오는 중' });
      try {
        // 글 하나 가져오기는 출간과 같다: 블로그에서 글을 다시 읽어 커밋한다
        const source = sourceFor(msg.blog, msg.username.trim());
        return await record('과거 글 하나', () =>
          keepAlive(async () => {
            const result = await publish(msg.id, token, source);
            // 비공개·임시저장이라 저장하지 않았으면 성공으로 알리지 않는다 (팝업 목록에 남게)
            if (!result.saved) throw new Error(result.message);
            return result;
          }),
        );
      } finally {
        importing = false;
        await store.remove('importStatus');
      }
    }
    case 'login': {
      const code = await requestDeviceCode();
      const pending = {
        userCode: code.user_code,
        verificationUri: code.verification_uri,
        expiresAt: Date.now() + code.expires_in * 1000,
      };
      await store.set({ pending, authError: null });
      waitForLogin(code); // 끝까지 기다리지 않고 팝업에 코드를 먼저 돌려준다
      return pending;
    }
    case 'logout':
      // GitHub 쪽 토큰 폐기는 비밀키가 필요해서 못 함. 사용자가 GitHub 설정에서 앱 권한을 지우면 된다.
      return store.remove(['token', 'user', 'repo', 'pending', 'authError']);
    case 'repos':
      return (await listRepos(token)).map((r) => r.full_name);
    case 'createRepo': {
      const repo = await createRepo(token, msg.name, msg.isPrivate);
      await store.set({ repo: repo.full_name });
      return repo.full_name;
    }
    case 'selectRepo':
      return store.set({ repo: msg.repo });
    default:
      throw new Error(`알 수 없는 요청: ${msg.type}`);
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handle(msg, sender).then(
    (data) => sendResponse({ ok: true, data }),
    (e) => sendResponse({ ok: false, error: e.message }),
  );
  return true; // 비동기로 응답
});
