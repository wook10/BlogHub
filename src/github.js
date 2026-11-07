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

const toBase64 = (text) =>
  btoa(Array.from(new TextEncoder().encode(text), (b) => String.fromCharCode(b)).join(''));

const contentsUrl = (repo, path) => `/repos/${repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}`;

// 파일이 없으면 undefined
const getSha = (token, url) =>
  api(token, url).then(
    (file) => file.sha,
    (e) => {
      if (e.status === 404) return undefined;
      throw e;
    },
  );

// 파일을 만들거나 덮어써서 커밋한다. 이미 있던 파일이면 true.
export async function putFile(token, repo, path, text, message) {
  const url = contentsUrl(repo, path);
  const sha = await getSha(token, url);
  await api(token, url, { method: 'PUT', body: { message: message(!!sha), content: toBase64(text), sha } });
  return !!sha;
}

// 파일을 지우는 커밋을 만든다. 이미 없으면 아무것도 안 한다.
export async function deleteFile(token, repo, path, message) {
  const url = contentsUrl(repo, path);
  const sha = await getSha(token, url);
  if (sha) await api(token, url, { method: 'DELETE', body: { message, sha } });
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
