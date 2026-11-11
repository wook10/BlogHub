import { CLIENT_ID } from './config.js';

const API = 'https://api.github.com';

const AUTH_ERRORS = {
  expired_token: '코드가 만료됐어요. 다시 로그인해 주세요.',
  access_denied: '로그인을 취소했어요.',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function postJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`GitHub 요청 실패 (${res.status})`);
  return res.json();
}

// 반환: { device_code, user_code, verification_uri, expires_in, interval }
export function requestDeviceCode() {
  return postJson('https://github.com/login/device/code', { client_id: CLIENT_ID, scope: 'repo' });
}

// 사용자가 GitHub에서 코드를 입력할 때까지 interval초마다 토큰을 요청한다.
export async function pollToken(deviceCode, interval, { wait = sleep, onTick } = {}) {
  for (;;) {
    await wait(interval * 1000);
    await onTick?.();
    const data = await postJson('https://github.com/login/oauth/access_token', {
      client_id: CLIENT_ID,
      device_code: deviceCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    });
    if (data.access_token) return data.access_token;
    if (data.error === 'authorization_pending') continue;
    if (data.error === 'slow_down') {
      interval = data.interval ?? interval + 5;
      continue;
    }
    throw new Error(AUTH_ERRORS[data.error] ?? data.error_description ?? '로그인에 실패했어요.');
  }
}

// GitHub가 요청 제한(403/429)을 알려 주면 그만큼 기다렸다 다시 하는 횟수
const RATE_LIMIT_RETRIES = 3;

async function api(token, path, { method = 'GET', body } = {}) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(API + path, {
      method,
      cache: 'no-store', // 캐시된 옛 값으로 커밋하다 충돌나지 않게
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: body && JSON.stringify(body),
    });
    const retryAfter = Number(res.headers?.get('retry-after'));
    const resetAt = res.headers?.get('x-ratelimit-remaining') === '0' && Number(res.headers.get('x-ratelimit-reset')) * 1000;
    if ((res.status === 403 || res.status === 429) && (retryAfter || resetAt) && attempt < RATE_LIMIT_RETRIES) {
      await sleep(Math.min(retryAfter ? retryAfter * 1000 : resetAt - Date.now(), 10 * 60_000) + 1000);
      continue;
    }
    const data = await res.json().catch(() => ({}));
    // 422 같은 오류는 message가 뭉뚱그려져 있고, 진짜 이유는 errors[0].message에 있다.
    if (!res.ok) {
      const message = data.errors?.[0]?.message ?? data.message ?? `GitHub API 실패 (${res.status})`;
      throw Object.assign(new Error(message), { status: res.status });
    }
    return data;
  }
}

function bytesToBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

const deleted = (path) => ({ path, mode: '100644', type: 'blob', sha: null });

// 기본 브랜치의 최신 커밋 sha
async function headSha(token, repo, branch) {
  try {
    return (await api(token, `/repos/${repo}/git/ref/heads/${branch}`)).object.sha;
  } catch (e) {
    if (e.status !== 409) throw e;
    // 커밋이 하나도 없는 빈 저장소(409)에는 Git Data API를 쓸 수 없어서 README로 첫 커밋을 만든다
    await api(token, `/repos/${repo}/contents/README.md`, {
      method: 'PUT',
      body: { message: 'BlogHub 시작', content: btoa('# blog backup\n') },
    });
    return (await api(token, `/repos/${repo}/git/ref/heads/${branch}`)).object.sha;
  }
}

// 이미지를 연달아 올릴 때 GitHub의 "1분에 콘텐츠 생성 80번" 제한에 걸리지 않게 둔 간격
const BLOB_GAP_MS = 800;
// 커밋하는 사이 다른 커밋이 끼어들면(non-fast-forward) 최신 상태 위에서 다시 하는 횟수
const COMMIT_RETRIES = 3;

// 여러 파일 변경을 커밋 하나로 만든다 (Git Data API).
// files: { 경로: 문자열 | Uint8Array(이미지) | null(삭제) }
// deleteDirs: 이 폴더 안의 파일 중 files에 없는 것은 지운다 (글에서 빠진 이미지 정리)
// message: 문자열, 또는 커밋 전 저장소에 있던 경로 Set을 받아 문자열을 돌려주는 함수
// 반환: 커밋 전 저장소에 있던 경로 Set (committed 속성: 실제로 커밋을 만들었는지). 바뀐 게 없으면 커밋하지 않는다.
export async function commitFiles(token, repo, { files, deleteDirs = [], message }) {
  const { default_branch: branch } = await api(token, `/repos/${repo}`);
  await headSha(token, repo, branch); // 빈 저장소면 여기서 첫 커밋을 만든다 (blob을 올리기 전에 필요)

  // 이미지는 한 번만 올려 두고, 다시 시도할 때는 sha만 다시 쓴다
  const writes = [];
  let blobs = 0;
  for (const [path, content] of Object.entries(files)) {
    if (content === null) continue;
    if (typeof content === 'string') {
      writes.push({ path, mode: '100644', type: 'blob', content });
      continue;
    }
    if (blobs++) await sleep(BLOB_GAP_MS);
    const blob = await api(token, `/repos/${repo}/git/blobs`, {
      method: 'POST',
      body: { content: bytesToBase64(content), encoding: 'base64' },
    });
    writes.push({ path, mode: '100644', type: 'blob', sha: blob.sha });
  }

  for (let attempt = 1; ; attempt++) {
    const parent = await headSha(token, repo, branch);
    const head = await api(token, `/repos/${repo}/git/commits/${parent}`);
    const tree = await api(token, `/repos/${repo}/git/trees/${head.tree.sha}?recursive=1`);
    // 목록이 잘리면 무엇을 지울지 확신할 수 없으니 멈춘다 (파일 10만 개 이상인 저장소)
    if (tree.truncated) throw new Error('저장소 파일이 너무 많아요.');
    const has = new Set(tree.tree.filter((e) => e.type === 'blob').map((e) => e.path));

    const entries = [...writes];
    for (const [path, content] of Object.entries(files)) {
      // 없는 파일을 지우라고 하면 GitHub가 오류를 내므로 있는 것만 지운다
      if (content === null && has.has(path)) entries.push(deleted(path));
    }
    for (const path of has) {
      if (!(path in files) && deleteDirs.some((dir) => path.startsWith(`${dir}/`))) entries.push(deleted(path));
    }
    if (!entries.length) return Object.assign(has, { committed: false });

    const newTree = await api(token, `/repos/${repo}/git/trees`, {
      method: 'POST',
      body: { base_tree: head.tree.sha, tree: entries },
    });
    if (newTree.sha === head.tree.sha) return Object.assign(has, { committed: false }); // 내용이 그대로면 빈 커밋을 만들지 않는다
    const commit = await api(token, `/repos/${repo}/git/commits`, {
      method: 'POST',
      body: { message: typeof message === 'function' ? message(has) : message, tree: newTree.sha, parents: [parent] },
    });
    try {
      await api(token, `/repos/${repo}/git/refs/heads/${branch}`, { method: 'PATCH', body: { sha: commit.sha } });
      return Object.assign(has, { committed: true });
    } catch (e) {
      if (e.status !== 422 || attempt >= COMMIT_RETRIES) throw e;
    }
  }
}

// 기본 브랜치(HEAD)의 파일 전체 [{ path, sha }].
// shortcut: 파일이 10만 개를 넘어 목록이 잘리면 일부만 본다, 그런 저장소가 생기면 폴더별로 나눠 읽자.
export async function listFiles(token, repo) {
  const tree = await api(token, `/repos/${repo}/git/trees/HEAD?recursive=1`);
  return tree.tree.filter((e) => e.type === 'blob').map(({ path, sha }) => ({ path, sha }));
}

// 파일 내용 (UTF-8 글자)
export async function readBlob(token, repo, sha) {
  const { content } = await api(token, `/repos/${repo}/git/blobs/${sha}`);
  return new TextDecoder().decode(Uint8Array.from(atob(content.replace(/\n/g, '')), (c) => c.charCodeAt(0)));
}

export const getUser = (token) => api(token, '/user');

// shortcut: 최근 수정된 내 저장소 100개만 보여 줌, 더 필요하면 페이지네이션 추가
export const listRepos = (token) => api(token, '/user/repos?affiliation=owner&sort=updated&per_page=100');

// auto_init: 첫 커밋(README)을 만들어 둬야 이후 커밋할 기본 브랜치가 생긴다.
export const createRepo = (token, name, isPrivate) =>
  api(token, '/user/repos', {
    method: 'POST',
    body: { name, private: isPrivate, auto_init: true, description: '블로그 글 (BlogHub)' },
  });
