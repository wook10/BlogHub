import { requestDeviceCode, pollToken, getUser, listRepos, createRepo, commitFiles } from './github.js';
import { toMarkdown, filePath, findImages, imageDir, imageName, relativeLink } from './markdown.js';
import { fetchAllPosts } from './velog.js';

const store = chrome.storage.local;

// 서비스 워커가 새로 떴다면 전에 하던 가져오기는 이미 멈춘 것이라 표시를 지운다
store.remove('importStatus');

const isPost = (p) =>
  p && ['id', 'title', 'body', 'username', 'url_slug', 'released_at'].every((k) => typeof p[k] === 'string') &&
  Array.isArray(p.tags);

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
  // 2단계 때는 저장소 구분 없이 paths[id]에 경로를 저장했다
  const pathOf = (id) => paths[repo]?.[id] ?? (typeof paths[id] === 'string' ? paths[id] : undefined);
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
async function postFiles(post, backupImages) {
  const date = new Date(post.released_at).toLocaleDateString('sv-SE'); // YYYY-MM-DD, 내 컴퓨터 시간대
  const path = filePath(post, date);
  const files = {};
  let body = post.body;
  if (backupImages) {
    const dir = imageDir(path);
    for (const [i, url] of findImages(body).entries()) {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(res.status);
        const file = `${dir}/${imageName(url, i, res.headers.get('content-type') ?? '')}`;
        files[file] = new Uint8Array(await res.arrayBuffer());
        body = body.replaceAll(url, relativeLink(path, file));
      } catch {
        // 못 받은 이미지는 원래 velog 링크를 그대로 둔다
      }
    }
  }
  files[path] = toMarkdown({ ...post, body }, date);
  return { path, files };
}

async function remove(id, token) {
  const { repo, pathOf, remember } = await target(token);
  const oldPath = pathOf(id);
  if (!oldPath) return 'GitHub에 저장된 적 없는 글이라 지울 파일이 없어요.';
  await commitFiles(token, repo, {
    files: { [oldPath]: null },
    deleteDirs: [imageDir(oldPath)],
    message: `[velog] 삭제: ${oldPath.split('/').pop()}`,
  });
  await remember({ [id]: null });
  return 'GitHub에서도 지웠어요.';
}

async function publish(post, token) {
  const { repo, savePrivate, backupImages, pathOf, remember } = await target(token);
  const oldPath = pathOf(post.id);
  await store.set({ velogUser: post.username }); // 과거 글 가져오기 칸에 미리 채워 둔다

  if (post.is_private && !savePrivate) {
    if (!oldPath) return '비공개 글이라 GitHub에 저장하지 않았어요.';
    // 저장했던 글을 비공개로 바꿨으면 저장소에서도 지운다
    await commitFiles(token, repo, {
      files: { [oldPath]: null },
      deleteDirs: [imageDir(oldPath)],
      message: `[velog] ${post.title} 비공개 전환`,
    });
    await remember({ [post.id]: null });
    return '비공개로 바뀐 글이라 GitHub에서 지웠어요.';
  }

  const { path, files } = await postFiles(post, backupImages);
  // 시리즈나 글 주소가 바뀌어 경로가 달라졌으면 예전 파일과 이미지를 지운다
  if (oldPath && oldPath !== path) files[oldPath] = null;
  const has = await commitFiles(token, repo, {
    files,
    deleteDirs: [imageDir(path), ...(oldPath ? [imageDir(oldPath)] : [])],
    message: (has) => `[velog] ${post.title}${has.has(path) || oldPath ? ' 수정' : ''}`,
  });
  await remember({ [post.id]: path });
  return has.has(path) || oldPath ? 'GitHub에 수정 내용 저장됨' : 'GitHub에 저장됨';
}

// velog에 쓴 글 전체를 커밋 하나로 가져온다
async function importAll(username, token) {
  const { repo, savePrivate, backupImages, remember } = await target(token);
  const status = (importStatus) => store.set({ importStatus });
  const posts = await fetchAllPosts(username, (n) => status(`글 목록 불러오는 중 (${n}개)`));
  const files = {};
  const saved = {};
  for (const [i, post] of posts.entries()) {
    await status(`글 준비 중 ${i + 1}/${posts.length}`);
    if (post.is_private && !savePrivate) continue;
    const result = await postFiles(post, backupImages);
    Object.assign(files, result.files);
    saved[post.id] = result.path;
  }
  const count = Object.keys(saved).length;
  if (!count) return '가져올 글이 없어요.';
  await status('GitHub에 커밋하는 중');
  await commitFiles(token, repo, { files, message: `[velog] 과거 글 ${count}개 가져오기` });
  await remember(saved);
  return `과거 글 ${count}개를 GitHub에 저장했어요.`;
}

async function waitForLogin({ device_code, interval }) {
  try {
    // 확장 API를 부르면 서비스 워커가 잠들지 않으므로, 기다리는 동안 매번 storage를 건드린다.
    const token = await pollToken(device_code, interval, { onTick: () => store.get('pending') });
    const user = await getUser(token);
    await store.set({ token, user: user.login });
  } catch (e) {
    await store.set({ authError: e.message });
  } finally {
    await store.remove('pending');
  }
}

// 마지막 저장 결과를 남겨서 팝업에서 보여 준다
async function record(title, fn) {
  const lastSync = { time: Date.now(), title: title ?? '(제목 없음)' };
  try {
    const message = await fn();
    await store.set({ lastSync: { ...lastSync, ok: true, message } });
    return message;
  } catch (e) {
    console.error('[VelogHub] 저장 실패', e);
    await store.set({ lastSync: { ...lastSync, ok: false, message: e.message } });
    throw e;
  }
}

async function handle(msg, sender) {
  const { token } = await store.get('token');
  switch (msg.type) {
    case 'publish':
      if (!sender.url?.startsWith('https://velog.io/')) throw new Error('velog 페이지에서 온 요청이 아니에요');
      return record(msg.post?.title, () => {
        if (msg.error) throw new Error(msg.error);
        // velog-hook.js가 보낸 형식이 맞는 글만 받는다
        if (!isPost(msg.post)) throw new Error('글 정보 형식이 달라요 (velog가 바뀌었을 수 있어요)');
        return keepAlive(() => publish(msg.post, token));
      });
    case 'remove':
      if (!sender.url?.startsWith('https://velog.io/') || typeof msg.id !== 'string') throw new Error('잘못된 삭제 요청');
      return record('삭제한 글', () => remove(msg.id, token));
    case 'import': {
      if (typeof msg.username !== 'string' || !msg.username.trim()) throw new Error('velog 아이디를 입력해 주세요.');
      if ((await store.get('importStatus')).importStatus) throw new Error('이미 가져오는 중이에요.');
      await store.set({ importStatus: '시작하는 중' });
      // 오래 걸리니 팝업에는 바로 답하고, 진행 상황은 importStatus로 보여 준다
      record('과거 글 가져오기', () => keepAlive(() => importAll(msg.username.trim(), token)))
        .catch(() => {})
        .finally(() => store.remove('importStatus'));
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
