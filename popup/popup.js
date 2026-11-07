const $ = (id) => document.getElementById(id);
const store = chrome.storage.local;

async function send(msg) {
  $('error').textContent = '';
  const res = await chrome.runtime.sendMessage(msg);
  if (!res.ok) {
    $('error').textContent = res.error;
    throw new Error(res.error);
  }
  return res.data;
}

let reposLoaded = false;

async function render() {
  const { token, user, repo, pending, authError } = await store.get();
  const waiting = pending && pending.expiresAt > Date.now();

  $('login').hidden = !!token || waiting;
  $('pending').hidden = !!token || !waiting;
  $('main').hidden = !token;
  if (authError) $('error').textContent = authError;

  if (waiting) $('user-code').textContent = pending.userCode;
  if (token) {
    $('user').textContent = user;
    $('current-repo').textContent = repo ?? '없음';
    if (!reposLoaded) {
      reposLoaded = true;
      const repos = await send({ type: 'repos' }).catch(() => []);
      $('repo-select').replaceChildren(...repos.map((name) => new Option(name, name, false, name === repo)));
    }
  }
}

$('login-btn').onclick = () => send({ type: 'login' }).catch(() => {});

$('open-btn').onclick = async () => {
  const { pending } = await store.get('pending');
  await navigator.clipboard.writeText(pending.userCode).catch(() => {});
  chrome.tabs.create({ url: pending.verificationUri });
};

$('select-btn').onclick = () => {
  const repo = $('repo-select').value;
  if (repo) send({ type: 'selectRepo', repo }).catch(() => {});
};

$('create-form').onsubmit = async (e) => {
  e.preventDefault();
  const btn = e.submitter;
  btn.disabled = true; // 두 번 눌러 같은 저장소를 두 번 만들지 않게
  const name = await send({
    type: 'createRepo',
    name: $('repo-name').value.trim(),
    isPrivate: $('repo-private').checked,
  }).catch(() => null);
  btn.disabled = false;
  if (name) {
    $('repo-select').prepend(new Option(name, name, true, true));
    $('repo-name').value = '';
  }
};

$('logout-btn').onclick = () => {
  reposLoaded = false;
  send({ type: 'logout' }).catch(() => {});
};

chrome.storage.onChanged.addListener(render);
render();
