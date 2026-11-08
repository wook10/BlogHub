import { requestDeviceCode, pollToken, getUser, listRepos, createRepo, commitFiles } from './github.js';
import { toMarkdown, filePath, findImages, replaceImages, imageDir, imageName, relativeLink } from './markdown.js';
import { fetchPost, fetchAllPosts, normalize } from './velog.js';

const store = chrome.storage.local;

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
  if (!token || !repo) throw new Error('VelogHub 팝업에서 로그인하고 저장소를 연결해 주세요.');
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
// oldPath가 있으면 경로가 바뀐 예전 파일을 지우고, deleteDirs로 글에서 빠진 이미지를 정리한다.
async function postFiles(post, backupImages, oldPath) {
  const date = new Date(post.released_at).toLocaleDateString('sv-SE'); // YYYY-MM-DD, 내 컴퓨터 시간대
  const path = filePath(post, date);
  const files = {};
  const links = new Map();
  let imagesOk = true;
  if (backupImages) {
    const dir = imageDir(path);
    for (const [i, url] of findImages(post.body).entries()) {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(res.status);
        const file = `${dir}/${imageName(url, i, res.headers.get('content-type') ?? '')}`;
        files[file] = new Uint8Array(await res.arrayBuffer());
        links.set(url, relativeLink(path, file));
      } catch {
        imagesOk = false; // 못 받은 이미지는 원래 velog 링크를 그대로 둔다
      }
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

async function remove(id, token) {
  const { repo, pathOf, remember } = await target(token);
  const oldPath = pathOf(id);
  if (!oldPath) return 'GitHub에 저장된 적 없는 글이라 지울 파일이 없어요.';
  // 가짜 삭제 요청으로 백업이 지워지지 않게, velog에서 정말 없어졌는지 확인한다
  if (await fetchPost(id)) throw new Error('velog에 아직 있는 글이라 지우지 않았어요.');
  await deletePost(token, repo, oldPath, `[velog] 삭제: ${oldPath.split('/').pop()}`);
  await remember({ [id]: null });
  return 'GitHub에서도 지웠어요.';
}

async function publish(id, token) {
  const { repo, savePrivate, backupImages, pathOf, remember } = await target(token);
  // 페이지가 보낸 내용은 믿지 않고 velog 서버에서 글을 직접 받는다. 실패하면 추측하지 않고 멈춘다.
  const post = await fetchPost(id);
  if (!post) throw new Error('velog에서 글을 찾지 못했어요. 비공개 글이면 velog에 로그인돼 있는지 확인해 주세요.');
  const done = (message) => ({ title: post.title, message });
  if (post.is_temp) return done('임시저장 글이라 저장하지 않았어요.');
  await store.set({ velogUser: post.username }); // 과거 글 가져오기 칸에 미리 채워 둔다
  const oldPath = pathOf(post.id);

  if (post.is_private && !savePrivate) {
    if (!oldPath) return done('비공개 글이라 GitHub에 저장하지 않았어요.');
    // 저장했던 글을 비공개로 바꿨으면 저장소에서도 지운다
    await deletePost(token, repo, oldPath, `[velog] ${post.title} 비공개 전환`);
    await remember({ [post.id]: null });
    return done('비공개로 바뀐 글이라 GitHub에서 지웠어요.');
  }

  const { path, files, deleteDirs } = await postFiles(post, backupImages, oldPath);
  const has = await commitFiles(token, repo, {
    files,
    deleteDirs,
    message: (has) => `[velog] ${post.title}${has.has(path) || oldPath ? ' 수정' : ''}`,
  });
  await remember({ [post.id]: path });
  return done(has.has(path) || oldPath ? 'GitHub에 수정 내용 저장됨' : 'GitHub에 저장됨');
}

// 이미지 메모리와 GitHub 요청이 한꺼번에 몰리지 않게 이만큼씩 나눠 커밋한다
const IMPORT_CHUNK = 10;

// velog에 쓴 글 전체를 가져온다
async function importAll(username, token) {
  const { repo, savePrivate, backupImages, pathOf, remember } = await target(token);
  const status = (importStatus) => store.set({ importStatus });
  const raw = await fetchAllPosts(username, (n) => status(`글 목록 불러오는 중 (${n}개)`));
  let saved = 0;
  let broken = 0;
  for (let start = 0; start < raw.length; start += IMPORT_CHUNK) {
    const files = {};
    const deleteDirs = [];
    const paths = {};
    for (const [j, item] of raw.slice(start, start + IMPORT_CHUNK).entries()) {
      await status(`글 준비 중 ${start + j + 1}/${raw.length}`);
      let post;
      try {
        post = normalize(item);
      } catch {
        broken++; // 정보가 빠진 글 하나 때문에 전체를 멈추지 않는다
        continue;
      }
      if (post.is_temp || (post.is_private && !savePrivate)) continue;
      const result = await postFiles(post, backupImages, pathOf(post.id));
      Object.assign(files, result.files);
      deleteDirs.push(...result.deleteDirs);
      paths[post.id] = result.path;
    }
    const count = Object.keys(paths).length;
    if (!count) continue;
    const end = Math.min(start + IMPORT_CHUNK, raw.length);
    await status(`GitHub에 커밋하는 중 (${end}/${raw.length})`);
    await commitFiles(token, repo, { files, deleteDirs, message: `[velog] 과거 글 가져오기 (${start + 1}~${end})` });
    await remember(paths); // 나눠 커밋하므로 중간에 멈춰도 여기까지는 저장된다
    saved += count;
  }
  if (!saved) return '가져올 글이 없어요.';
  return `과거 글 ${saved}개를 GitHub에 저장했어요.${broken ? ` (정보가 빠진 글 ${broken}개는 건너뜀)` : ''}`;
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
    console.error('[VelogHub] 실패', e);
    await store.set({ lastSync: { time, title, ok: false, message: e.message } });
    throw e;
  }
}

let importing = false; // 서비스 워커 안에서 하나만 돌게 (storage 확인은 동시에 두 번 통과할 수 있음)

async function handle(msg, sender) {
  const { token } = await store.get('token');
  switch (msg.type) {
    case 'publish':
    case 'remove': {
      if (!sender.url?.startsWith('https://velog.io/')) throw new Error('velog 페이지에서 온 요청이 아니에요');
      const removing = msg.type === 'remove';
      return record(removing ? '삭제한 글' : '출간한 글', () => {
        if (msg.error) throw new Error(`${removing ? '삭제' : '출간'} 감지 중 오류: ${msg.error}`);
        if (typeof msg.id !== 'string' || !msg.id) throw new Error('글 id가 없어요 (velog가 바뀌었을 수 있어요)');
        return keepAlive(() => (removing ? remove : publish)(msg.id, token));
      });
    }
    case 'import': {
      if (typeof msg.username !== 'string' || !msg.username.trim()) throw new Error('velog 아이디를 입력해 주세요.');
      if (importing) throw new Error('이미 가져오는 중이에요.');
      importing = true;
      await store.set({ importStatus: '시작하는 중' });
      // 오래 걸리니 팝업에는 바로 답하고, 진행 상황은 importStatus로 보여 준다
      record('과거 글 가져오기', () => keepAlive(() => importAll(msg.username.trim(), token)))
        .catch(() => {})
        .finally(() => {
          importing = false;
          store.remove('importStatus');
        });
      return null;
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
