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
let connectedRepo = null; // 저장해 둔 연결 저장소 (연결 버튼 글자에 쓴다)
let listing = false; // 목록을 불러오는 중
let pendingImports = 0; // 차례를 기다리거나 가져오는 중인 글 수 (그동안 목록을 새로 만들지 않게)
let queue = Promise.resolve(); // 고른 글을 차례대로 가져온다 (여러 개를 빠르게 눌러도 하나씩)

async function render() {
  const {
    token, user, repo, pending, authError, lastSync, savePrivate = false, backupImages = true, autoSave = true, importStatus,
    importBlog = 'velog', velogUser, importUser = velogUser, // velogUser: 1.0.0이 저장한 값
  } = await store.get();
  $('auto-save').checked = autoSave;
  $('save-private').checked = savePrivate;
  $('backup-images').checked = backupImages;
  // 마지막으로 글을 저장한 블로그와 아이디를 미리 채운다 (직접 고친 값은 그대로 둔다)
  if (importUser && !$('import-user').value) {
    $('import-blog').value = importBlog;
    $('import-user').value = importUser;
    showPlaceholder();
  }
  $('import-btn').disabled = !!importStatus || pendingImports > 0;
  $('list-btn').disabled = !!importStatus || listing || pendingImports > 0;
  $('import-status').textContent = importStatus ?? '비공개 글은 "비공개 글도 저장"을 켜야 가져와요.';
  if (lastSync) {
    const time = new Date(lastSync.time).toLocaleString();
    $('last-sync').textContent = `최근 기록 (${time}) "${lastSync.title}": ${lastSync.message}`;
    $('last-sync').className = lastSync.ok ? 'ok' : 'fail';
  }
  const waiting = pending && pending.expiresAt > Date.now();

  $('login').hidden = !!token || waiting;
  $('pending').hidden = !!token || !waiting;
  $('main').hidden = !token;
  $('settings-btn').hidden = !token;
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
    connectedRepo = repo ?? null;
    showConnected();
  }
}

$('login-btn').onclick = () => send({ type: 'login' }).catch(() => {});

$('open-btn').onclick = async () => {
  const { pending } = await store.get('pending');
  await navigator.clipboard.writeText(pending.userCode).catch(() => {});
  chrome.tabs.create({ url: pending.verificationUri });
};

// 버튼 글자로 진행 상황을 보여 준다 ("연결 중…"). 끝나면 원래 글자로 돌리고 상태에 맞게 다시 그린다.
async function withProgress(btn, busy, task) {
  const label = btn.textContent;
  btn.disabled = true; // 두 번 눌러 같은 일을 두 번 하지 않게
  btn.textContent = busy;
  await task().catch(() => {});
  btn.textContent = label;
  btn.disabled = false;
  showConnected();
}

// 지금 연결된 저장소를 고르고 있으면 버튼에 "연결됨"을 계속 보여 준다
function showConnected() {
  const connected = !!connectedRepo && $('repo-select').value === connectedRepo;
  $('select-btn').textContent = connected ? '연결됨' : '연결';
  $('select-btn').disabled = connected;
}
$('repo-select').onchange = showConnected;

$('select-btn').onclick = () => {
  const repo = $('repo-select').value;
  if (repo) withProgress($('select-btn'), '연결 중…', () => send({ type: 'selectRepo', repo }));
};

$('create-form').onsubmit = async (e) => {
  e.preventDefault();
  let name;
  await withProgress(e.submitter, '만드는 중…', async () => {
    name = await send({ type: 'createRepo', name: $('repo-name').value.trim(), isPrivate: $('repo-private').checked });
  });
  if (name) {
    $('repo-select').prepend(new Option(name, name, true, true));
    $('repo-name').value = '';
    showConnected();
  }
};

// 톱니바퀴를 누르면 설정 화면으로 바꾸고, 다시 누르면 돌아온다
$('settings-btn').onclick = () => {
  const open = $('settings').hidden;
  $('settings').hidden = !open;
  $('main').classList.toggle('settings-open', open); // 설정을 펼치면 설정만 보인다
  $('settings-btn').setAttribute('aria-expanded', String(open));
};
$('auto-save').onchange = (e) => store.set({ autoSave: e.target.checked });
$('save-private').onchange = (e) => store.set({ savePrivate: e.target.checked });
$('backup-images').onchange = (e) => store.set({ backupImages: e.target.checked });
$('import-btn').onclick = () => {
  $('missing').hidden = true; // 한 번에 가져오면 목록은 의미가 없어진다
  send({ type: 'import', blog: $('import-blog').value, username: $('import-user').value }).catch(() => {});
};

// 저장소에 아직 없는 글 목록을 보여 주고, 글마다 가져오기 버튼을 단다
$('list-btn').onclick = async () => {
  const blog = $('import-blog').value;
  const username = $('import-user').value;
  const list = $('missing');
  listing = $('list-btn').disabled = true;
  list.hidden = false;
  list.replaceChildren(item('목록을 불러오는 중…'));
  const posts = await send({ type: 'missingPosts', blog, username }).catch(() => null);
  listing = $('list-btn').disabled = false;
  if (!posts) return (list.hidden = true);
  if (!posts.length) return list.replaceChildren(item('저장소에 없는 글이 없어요.'));
  list.replaceChildren(
    ...posts.map((p) => {
      const btn = document.createElement('button');
      btn.textContent = '가져오기';
      btn.onclick = () => {
        btn.disabled = true;
        btn.textContent = '대기 중';
        pendingImports++;
        $('list-btn').disabled = true;
        queue = queue.then(async () => {
          btn.textContent = '가져오는 중';
          const ok = await send({ type: 'importOne', blog, username, id: String(p.id) }).then(
            () => true,
            () => false,
          );
          if (ok) {
            li.remove();
          } else {
            btn.disabled = false;
            btn.textContent = '다시';
          }
          if (!list.children.length) list.replaceChildren(item('모두 가져왔어요.'));
          if (--pendingImports === 0) render();
        });
      };
      const li = item(`${p.title || '(제목 없음)'}${p.isPrivate ? ' 🔒' : ''}`, btn);
      return li;
    }),
  );
  // 글이 5개를 넘으면 5줄 높이에서 멈추고 나머지는 스크롤로
  const rows = list.children;
  list.style.maxHeight =
    rows.length > 5 ? `${rows[5].getBoundingClientRect().top - rows[0].getBoundingClientRect().top}px` : '';
};

function item(text, button) {
  const li = document.createElement('li');
  const span = document.createElement('span');
  span.textContent = text;
  span.title = text;
  li.append(span, ...(button ? [button] : []));
  return li;
}

// 고른 블로그에 맞게 어떤 아이디를 넣는지 보여 준다
function showPlaceholder() {
  $('import-user').placeholder = $('import-blog').value === 'tistory' ? '아이디 또는 아이디.tistory.com' : 'velog.io/@아이디';
}
$('import-blog').onchange = showPlaceholder;

$('logout-btn').onclick = () => {
  reposLoaded = false;
  send({ type: 'logout' }).catch(() => {});
};

chrome.storage.onChanged.addListener(render);
render();
