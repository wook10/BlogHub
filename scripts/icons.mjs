// icons/icon.svg로 확장 아이콘 PNG(16/32/48/128)를 다시 만든다. 크롬(헤드리스)으로 그린다.
// 사용법: npm run icons   (크롬 위치가 다르면 CHROME=크롬경로 npm run icons)
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const chrome = [
  process.env.CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
].find((p) => p && existsSync(p));
if (!chrome) throw new Error('크롬을 찾지 못했어요. CHROME 환경 변수에 크롬 경로를 넣어 주세요.');

const svg = pathToFileURL(resolve('icons/icon.svg')).href;
const work = mkdtempSync(join(tmpdir(), 'bloghub-icons-'));
try {
  for (const size of [16, 32, 48, 128]) {
    const page = join(work, `${size}.html`);
    const out = join(work, `${size}.png`);
    writeFileSync(page, `<body style="margin:0"><img src="${svg}" width="${size}" height="${size}" style="display:block">`);
    spawnSync(chrome, [
      '--headless=new', '--disable-gpu', '--hide-scrollbars', '--default-background-color=00000000',
      `--user-data-dir=${join(work, 'profile')}`, `--window-size=${size},${size}`, `--screenshot=${out}`,
      pathToFileURL(page).href,
    ]);
    if (!existsSync(out)) throw new Error(`${size}px 아이콘을 만들지 못했어요.`);
    copyFileSync(out, `icons/${size}.png`);
    console.log(`icons/${size}.png`);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
