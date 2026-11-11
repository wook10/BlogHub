import { cleanFolder } from '../src/markdown.js';
import { PROFILE_VERSION } from '../src/tone.js';

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
let savedFolders = {}; // 저장소마다 고른 저장 폴더
let listing = false; // 목록을 불러오는 중
let pendingImports = 0; // 차례를 기다리거나 가져오는 중인 글 수 (그동안 목록을 새로 만들지 않게)
let queue = Promise.resolve(); // 고른 글을 차례대로 가져온다 (여러 개를 빠르게 눌러도 하나씩)

async function render() {
  const {
    token, user, repo, pending, authError, lastSync, savePrivate = false, backupImages = true, autoSave = true, importStatus,
    folders = {}, tone = 'original', geminiKey = '', toneProfile,
    importBlog = 'velog', velogUser, importUser = velogUser, // velogUser: 1.0.0이 저장한 값
  } = await store.get();
  $('auto-save').checked = autoSave;
  $('save-private').checked = savePrivate;
  $('backup-images').checked = backupImages;
  $('tone').value = tone;
  if (document.activeElement !== $('api-key')) $('api-key').value = geminiKey;
  $('key-box').hidden = tone === 'original';
  $('tone-mine').hidden = tone !== 'mine';
  if (!$('tone-status').dataset.busy) {
    $('tone-status').textContent =
      tone === 'original' ? '' : !geminiKey ? 'API 키를 넣어야 말투를 바꿀 수 있어요.'
      : tone === 'mine' ? (toneProfile?.v === PROFILE_VERSION ? `내 말투 분석함 (${new Date(toneProfile.time).toLocaleDateString()})` : '처음 가져올 때 내 GitHub 글을 보고 말투를 분석해요.')
      : '';
  }
  savedFolders = folders;
  // 마지막으로 글을 저장한 블로그와 아이디를 미리 채운다 (직접 고친 값은 그대로 둔다)
  if (importUser && !$('import-user').value) {
    $('import-blog').value = importBlog;
    $('import-user').value = importUser;
    showPlaceholder();
  }
  $('import-btn').disabled = !!importStatus || pendingImports > 0;
  $('list-btn').disabled = !!importStatus || listing || pendingImports > 0;
  $('import-status').textContent =
    importStatus ?? `비공개 글은 "비공개 글도 저장"을 켜야 가져와요.${tone === 'original' ? '' : ' 말투를 바꿔 가져올 때는 비공개 글을 건너뛰어요.'}`;
  if (lastSync) {
    // 위 줄: 무엇을 했는지와 언제, 아래 줄: 결과 (성공·실패는 왼쪽 선 색)
    const title = document.createElement('b');
    title.textContent = lastSync.title;
    const time = document.createElement('span');
    time.className = 'sync-time';
    time.textContent = new Date(lastSync.time).toLocaleString('ko-KR', {
      month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit',
    });
    const head = document.createElement('div');
    head.append(title, ' ', time);
    const message = document.createElement('div');
    message.textContent = lastSync.message;
    $('last-sync').replaceChildren(head, message);
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
    // 저장소와 그 안의 폴더를 GitHub 주소처럼 한 줄로 (어디에 저장되는지 한눈에)
    $('current-repo').textContent = repo ? `${repo}/${cleanFolder(folders[repo])}` : '아직 연결 안 함';
    if (!reposLoaded) {
      reposLoaded = true;
      const repos = await send({ type: 'repos' }).catch(() => []);
      $('repo-select').replaceChildren(...repos.map((name) => new Option(name, name, false, name === repo)));
      loadFolders();
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

const folderOf = (repo) => savedFolders[repo] ?? 'posts';
const NEW_FOLDER = '\n새 폴더'; // 폴더 이름에 쓸 수 없는 값이라 실제 폴더와 겹치지 않는다

// 고른 폴더. 백그라운드가 저장하는 이름과 같게 정리해야 "연결됨"을 바르게 보여 준다 ("TIL/"과 "TIL"은 같은 폴더)
const typedFolder = () =>
  cleanFolder($('folder-select').value === NEW_FOLDER ? $('repo-folder').value : $('folder-select').value);

function showFolders(dirs, current) {
  const names = [...new Set([current, 'posts', ...dirs])].sort();
  $('folder-select').replaceChildren(
    ...names.map((d) => new Option(d, d, false, d === current)),
    new Option('+ 새 폴더 만들기', NEW_FOLDER),
  );
  $('repo-folder').hidden = true;
}

// 지금 연결된 저장소와 폴더를 고르고 있으면 버튼에 "연결됨"을 계속 보여 준다
function showConnected() {
  const repo = $('repo-select').value;
  const connected = !!connectedRepo && repo === connectedRepo && typedFolder() === folderOf(repo);
  $('select-btn').textContent = connected ? '연결됨' : '연결';
  $('select-btn').disabled = connected;
}

// 고른 저장소의 폴더 목록으로 저장 폴더 칸을 채운다
async function loadFolders() {
  const repo = $('repo-select').value;
  showFolders([], folderOf(repo)); // 목록이 오기 전에도 지금 폴더는 보이게
  showConnected();
  if (!repo) return;
  const dirs = (await send({ type: 'repoFolders', repo }).catch(() => null)) ?? [];
  if ($('repo-select').value !== repo) return; // 그사이 다른 저장소를 골랐다
  showFolders(dirs, folderOf(repo));
  showConnected();
}
$('repo-select').onchange = loadFolders;
$('folder-select').onchange = () => {
  const isNew = $('folder-select').value === NEW_FOLDER;
  $('repo-folder').hidden = !isNew;
  if (isNew) $('repo-folder').focus();
  showConnected();
};
$('repo-folder').oninput = showConnected;

$('select-btn').onclick = () => {
  const repo = $('repo-select').value;
  const folder = typedFolder();
  if (repo) withProgress($('select-btn'), '연결 중…', () => send({ type: 'selectRepo', repo, folder }));
};

$('create-form').onsubmit = async (e) => {
  e.preventDefault();
  let name;
  // 폴더 목록은 위에서 고른 다른 저장소의 것이라, 새 폴더 이름을 직접 쓴 경우만 쓰고 아니면 posts
  const folder = $('folder-select').value === NEW_FOLDER ? typedFolder() : 'posts';
  await withProgress(e.submitter, '만드는 중…', async () => {
    name = await send({ type: 'createRepo', name: $('repo-name').value.trim(), isPrivate: $('repo-private').checked, folder });
  });
  if (name) {
    savedFolders = { ...savedFolders, [name]: folder }; // 저장값 변경 알림보다 먼저 보여 줘도 맞게
    $('repo-select').prepend(new Option(name, name, true, true));
    $('repo-name').value = '';
    loadFolders(); // 새 저장소의 폴더로 바꿔 보여 준다
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
$('tone').onchange = (e) => store.set({ tone: e.target.value });
$('api-key').onchange = (e) => {
  const key = e.target.value.trim();
  // 키는 영어·숫자·기호뿐이다. 복사하다 한글 같은 글자가 섞이면 요청이 이상하게 실패하므로 저장 전에 알려 준다.
  if (key && !/^[\x21-\x7e]+$/.test(key)) {
    $('error').textContent = 'API 키에는 영어, 숫자, 기호만 들어가요. 복사할 때 다른 글자가 섞이지 않았는지 확인해 주세요.';
    return;
  }
  $('error').textContent = '';
  store.set({ geminiKey: key });
};
$('analyze-btn').onclick = async () => {
  const status = $('tone-status');
  status.dataset.busy = '1';
  status.textContent = '내 GitHub 글을 읽고 말투를 분석하는 중…';
  await withProgress($('analyze-btn'), '분석 중…', async () => {
    await send({ type: 'analyzeTone' });
  });
  delete status.dataset.busy;
  render();
};
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
  const found = await send({ type: 'missingPosts', blog, username }).catch(() => null);
  listing = $('list-btn').disabled = false;
  if (!found) return (list.hidden = true);
  const { posts, total, saved, privateHidden } = found;
  if (!posts.length) {
    const note = item(emptyReason(total, saved, privateHidden));
    note.className = 'note'; // 이유가 길어서 줄바꿈을 허용한다
    return list.replaceChildren(note);
  }
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

// 목록이 비었을 때 왜 비었는지 (블로그 글이 없는지, 이미 저장됐는지, 비공개라 뺐는지)
function emptyReason(total, saved, privateHidden) {
  if (!total) return '블로그에서 글을 하나도 찾지 못했어요. 아이디와 로그인을 확인해 주세요.';
  const parts = [`블로그 글 ${total}개`];
  if (saved) parts.push(`이미 저장된 글 ${saved}개`);
  if (privateHidden) parts.push(`비공개 글 ${privateHidden}개 (⚙ 설정에서 "비공개 글도 GitHub에 저장"을 켜면 보여요)`);
  return `저장소에 없는 글이 없어요. ${parts.join(', ')}.`;
}

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
