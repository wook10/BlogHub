import { requestDeviceCode, pollToken, getUser, listRepos, createRepo, putFile } from './github.js';
import { toMarkdown, filePath } from './markdown.js';

const store = chrome.storage.local;

const isPost = (p) =>
  p && ['id', 'title', 'body', 'username', 'url_slug', 'released_at'].every((k) => typeof p[k] === 'string') &&
  Array.isArray(p.tags);

async function publish(post, token) {
  const { repo, paths = {} } = await store.get(['repo', 'paths']);
  if (!token || !repo) throw new Error('VelogHub 팝업에서 로그인하고 저장소를 연결해 주세요.');
  // shortcut: 비공개 글은 항상 건너뜀 (공개 저장소에 새지 않게), 3단계에서 설정으로 바꿈
  if (post.is_private) return '비공개 글이라 GitHub에 저장하지 않았어요.';

  const date = new Date(post.released_at).toLocaleDateString('sv-SE'); // YYYY-MM-DD, 내 컴퓨터 시간대
  // 글 주소(slug)를 바꿔 수정해도 처음 저장한 파일을 계속 쓴다
  const path = paths[post.id] ?? filePath(post, date);
  const updated = await putFile(token, repo, path, toMarkdown(post, date), (exists) =>
    `[velog] ${post.title}${exists ? ' 수정' : ''}`,
  );
  await store.set({ paths: { ...paths, [post.id]: path } });
  return updated ? 'GitHub에 수정 내용 저장됨' : 'GitHub에 저장됨';
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
