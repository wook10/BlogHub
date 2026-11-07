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

async function api(token, path, { method = 'GET', body } = {}) {
  const res = await fetch(API + path, {
    method,
    cache: 'no-store', // 캐시된 옛 sha로 덮어쓰다 충돌(409)나지 않게
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: body && JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  // 422 같은 오류는 message가 뭉뚱그려져 있고, 진짜 이유는 errors[0].message에 있다.
  if (!res.ok) {
    const message = data.errors?.[0]?.message ?? data.message ?? `GitHub API 실패 (${res.status})`;
    throw Object.assign(new Error(message), { status: res.status });
  }
  return data;
}

function bytesToBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

const deleted = (path) => ({ path, mode: '100644', type: 'blob', sha: null });

// 여러 파일 변경을 커밋 하나로 만든다 (Git Data API).
// files: { 경로: 문자열 | Uint8Array(이미지) | null(삭제) }
// deleteDirs: 이 폴더 안의 파일 중 files에 없는 것은 지운다 (글에서 빠진 이미지 정리)
// message: 문자열, 또는 커밋 전 저장소에 있던 경로 Set을 받아 문자열을 돌려주는 함수
// 반환: 커밋 전 저장소에 있던 경로 Set. 바뀐 게 없으면 커밋하지 않는다.
export async function commitFiles(token, repo, { files, deleteDirs = [], message }) {
  const { default_branch: branch } = await api(token, `/repos/${repo}`);
  const ref = await api(token, `/repos/${repo}/git/ref/heads/${branch}`);
  const head = await api(token, `/repos/${repo}/git/commits/${ref.object.sha}`);
  const tree = await api(token, `/repos/${repo}/git/trees/${head.tree.sha}?recursive=1`);
  // 목록이 잘리면 무엇을 지울지 확신할 수 없으니 멈춘다 (파일 10만 개 이상인 저장소)
  if (tree.truncated) throw new Error('저장소 파일이 너무 많아요.');
  const has = new Set(tree.tree.filter((e) => e.type === 'blob').map((e) => e.path));

  const entries = [];
  for (const [path, content] of Object.entries(files)) {
    // 없는 파일을 지우라고 하면 GitHub가 오류를 내므로 있는 것만 지운다
    if (content === null) {
      if (has.has(path)) entries.push(deleted(path));
    } else if (typeof content === 'string') {
      entries.push({ path, mode: '100644', type: 'blob', content });
    } else {
      const blob = await api(token, `/repos/${repo}/git/blobs`, {
        method: 'POST',
        body: { content: bytesToBase64(content), encoding: 'base64' },
      });
      entries.push({ path, mode: '100644', type: 'blob', sha: blob.sha });
    }
  }
  for (const path of has) {
    if (!(path in files) && deleteDirs.some((dir) => path.startsWith(`${dir}/`))) entries.push(deleted(path));
  }
  if (!entries.length) return has;

  const newTree = await api(token, `/repos/${repo}/git/trees`, {
    method: 'POST',
    body: { base_tree: head.tree.sha, tree: entries },
  });
  if (newTree.sha === head.tree.sha) return has; // 내용이 그대로면 빈 커밋을 만들지 않는다
  const commit = await api(token, `/repos/${repo}/git/commits`, {
    method: 'POST',
    body: { message: typeof message === 'function' ? message(has) : message, tree: newTree.sha, parents: [ref.object.sha] },
  });
  await api(token, `/repos/${repo}/git/refs/heads/${branch}`, { method: 'PATCH', body: { sha: commit.sha } });
  return has;
}

export const getUser = (token) => api(token, '/user');

// shortcut: 최근 수정된 내 저장소 100개만 보여 줌, 더 필요하면 페이지네이션 추가
export const listRepos = (token) => api(token, '/user/repos?affiliation=owner&sort=updated&per_page=100');

// auto_init: 첫 커밋(README)을 만들어 둬야 이후 커밋할 기본 브랜치가 생긴다.
export const createRepo = (token, name, isPrivate) =>
  api(token, '/user/repos', {
    method: 'POST',
    body: { name, private: isPrivate, auto_init: true, description: 'velog 글 백업 (VelogHub)' },
  });
