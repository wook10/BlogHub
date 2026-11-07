import { requestDeviceCode, pollToken, getUser, listRepos, createRepo, putFile, deleteFile } from './github.js';
import { toMarkdown, filePath } from './markdown.js';

const store = chrome.storage.local;

const isPost = (p) =>
  p && ['id', 'title', 'body', 'username', 'url_slug', 'released_at'].every((k) => typeof p[k] === 'string') &&
  Array.isArray(p.tags);

// 연결된 저장소와, 그 저장소에 저장한 글 id → 파일 경로 기록
async function target(token, id) {
  const { repo, paths = {}, savePrivate = false } = await store.get(['repo', 'paths', 'savePrivate']);
  if (!token || !repo) throw new Error('VelogHub 팝업에서 로그인하고 저장소를 연결해 주세요.');
  const saved = paths[repo] ?? {};
  const remember = (path) => {
    const next = { ...saved };
    if (path) next[id] = path;
    else delete next[id];
    return store.set({ paths: { ...paths, [repo]: next } });
  };
  // 2단계 때는 저장소 구분 없이 paths[id]에 경로를 저장했다
  const legacy = typeof paths[id] === 'string' ? paths[id] : undefined;
  return { repo, savePrivate, oldPath: saved[id] ?? legacy, remember };
}

async function remove(id, token) {
  const { repo, oldPath, remember } = await target(token, id);
  if (!oldPath) return 'GitHub에 저장된 적 없는 글이라 지울 파일이 없어요.';
  await deleteFile(token, repo, oldPath, `[velog] 삭제: ${oldPath.split('/').pop()}`);
  await remember(null);
  return 'GitHub에서도 지웠어요.';
}

async function publish(post, token) {
  const { repo, savePrivate, oldPath, remember } = await target(token, post.id);

  if (post.is_private && !savePrivate) {
    if (!oldPath) return '비공개 글이라 GitHub에 저장하지 않았어요.';
    // 저장했던 글을 비공개로 바꿨으면 저장소에서도 지운다
    await deleteFile(token, repo, oldPath, `[velog] ${post.title} 비공개 전환`);
    await remember(null);
    return '비공개로 바뀐 글이라 GitHub에서 지웠어요.';
  }

  const date = new Date(post.released_at).toLocaleDateString('sv-SE'); // YYYY-MM-DD, 내 컴퓨터 시간대
  const path = filePath(post, date);
  const existed = await putFile(token, repo, path, toMarkdown(post, date), (exists) =>
    `[velog] ${post.title}${exists || oldPath ? ' 수정' : ''}`,
  );
  // 시리즈나 글 주소가 바뀌어 경로가 달라졌으면 예전 파일을 지운다
  if (oldPath && oldPath !== path) await deleteFile(token, repo, oldPath, `[velog] ${post.title} 이동`);
  await remember(path);
  return existed || oldPath ? 'GitHub에 수정 내용 저장됨' : 'GitHub에 저장됨';
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
        return publish(msg.post, token);
      });
    case 'remove':
      if (!sender.url?.startsWith('https://velog.io/') || typeof msg.id !== 'string') throw new Error('잘못된 삭제 요청');
      return record('삭제한 글', () => remove(msg.id, token));
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
