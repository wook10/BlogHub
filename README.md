<p align="center"><img src="icons/128.png" width="96" alt=""></p>

<h1 align="center">BlogHub</h1>

<p align="center">velog·티스토리에 글을 발행하는 순간, GitHub 저장소에 자동으로 커밋해 주는 크롬·엣지 확장 프로그램</p>

백준허브가 알고리즘 풀이를 GitHub에 올려 주듯, BlogHub는 블로그 글을 GitHub에 올려 줍니다.
블로그 활동은 GitHub 잔디로 이어지고, 글은 마크다운 파일로 내 저장소에 남습니다.

<p align="center"><img src="docs/popup.png" width="300" alt="BlogHub 팝업: GitHub 로그인, 저장소 연결, 설정, 과거 글 가져오기, 최근 저장 기록"></p>

## 기능

|  | velog | 티스토리 (베타) |
| --- | :---: | :---: |
| 발행하면 바로 커밋 (임시저장은 제외) | ✅ | ✅ |
| 수정·삭제 반영 | ✅ | ✅ |
| 이미지를 저장소에 백업 | ✅ | ✅ |
| 비공개 글 저장 (설정에서 켜기) | ✅ | ✅ |
| 원본 마크다운 그대로 | ✅ | HTML을 마크다운으로 변환 |
| 시리즈별 폴더 | ✅ | — |
| 과거 글 한 번에 가져오기 | ✅ | ✅ (내 블로그) |

## 설치

**Edge 스토어:** [BlogHub 설치](https://microsoftedge.microsoft.com/addons/detail/fjknniibbbgfommmdfmdaaanfkckbnjp) → **받기** → **확장 추가**

**직접 불러오기 (크롬·엣지):**

1. 이 저장소를 내려받습니다. (`git clone` 또는 `Code` → `Download ZIP` 후 압축 풀기)
2. 크롬은 `chrome://extensions`, 엣지는 `edge://extensions`를 열고 **개발자 모드**를 켭니다.
3. **압축해제된 확장 프로그램 로드**를 누르고 `manifest.json`이 있는 폴더를 고릅니다.

직접 불러온 확장은 자동으로 업데이트되지 않습니다. `git pull` 후 확장 페이지에서 새로고침(↻)을 누르세요.

## 사용법

1. 툴바의 BlogHub 아이콘 → **GitHub로 로그인**
2. 화면에 나온 코드를 GitHub 페이지에 입력하고 승인
3. 글을 저장할 저장소를 고르거나 새로 만들기 (예: `my-blog`)
4. 평소처럼 글을 발행하면 끝
   - **velog:** "출간하기"를 누르면 오른쪽 아래에 "GitHub에 저장됨" 알림이 뜹니다.
   - **티스토리:** `아이디.tistory.com` 관리 화면에서 발행·수정·삭제하면 커밋됩니다.

### 과거 글 가져오기

이미 쓴 글은 팝업 아래쪽의 **과거 글 가져오기**에서 가져옵니다. 블로그 종류를 고르고 아이디를 넣은 뒤 버튼을 누르세요.

- **한 번에 모두**: 지금까지 쓴 글을 모두 커밋합니다.
- **목록 보고 하나씩**: 저장소에 아직 없는 글 목록이 뜨고, 글마다 있는 **가져오기**를 누르면 그 글 하나만 커밋합니다. 원하는 글만, 원하는 때 하나씩 올릴 수 있습니다.

| 블로그 | 넣을 아이디 | 예 |
| --- | --- | --- |
| velog | `velog.io/@아이디`의 아이디 | `velog.io/@myname` → `myname` |
| tistory | `아이디.tistory.com`의 아이디 | `myblog.tistory.com` → `myblog` |

- 티스토리는 블로그 관리 화면의 글 목록을 읽기 때문에, **내 블로그만** 티스토리에 로그인한 상태에서 가져올 수 있습니다.
- 비공개 글은 설정의 **비공개 글도 GitHub에 저장**을 켜야 함께 가져옵니다.

## 저장되는 모습

```
my-blog/
└── posts/
    ├── 2026-11-07-글주소.md                 velog
    ├── 2026-11-08-글주소-12.md              티스토리 (끝은 글 번호)
    ├── 리액트 공부/                          velog 시리즈
    │   └── 2026-10-01-useState-정리.md
    └── images/
        └── 2026-11-07-글주소/
            └── 1.png
```

```markdown
---
title: "useState 정리"
date: 2026-10-01
tags: ["React","상태관리"]
series: "리액트 공부"
velog_url: https://velog.io/@아이디/useState-정리
---

본문...
```

- 티스토리 글은 `velog_url` 대신 `tistory_url`이 들어갑니다.
- 커밋 메시지: `[velog] 제목`, `[velog] 제목 수정`, `[velog] 삭제: 파일이름` (티스토리는 `[tistory]`)

## 알아둘 점

- **발행하면 바로 저장**(설정, 기본 켜짐)을 끄면 발행·수정한 글은 바로 커밋하지 않습니다. 팝업의 **목록 보고 하나씩**에서 원할 때 골라 올리세요. 블로그에서 지운 글은 꺼 둬도 저장소에서 지웁니다.
- **공개 저장소에 저장하면 누구나 글을 볼 수 있습니다.** 비공개 글까지 저장하려면 비공개 저장소를 쓰세요. 지운 글도 git 기록에는 남습니다.
- **비공개 글**은 "비공개 글도 GitHub에 저장"을 켜고, 같은 브라우저에서 블로그에 로그인돼 있어야 저장됩니다.
- velog와 티스토리 모두 공식 공개 API가 아니어서, 사이트가 바뀌면 동작하지 않을 수 있습니다. 실패하면 화면 알림과 팝업의 "최근 기록"에 이유가 나옵니다.
- **티스토리 변환:** 티스토리는 마크다운 모드로 써도 HTML만 저장하기 때문에 원본 마크다운은 남아 있지 않습니다. 그래서 티스토리 편집기와 같은 변환기([turndown](https://github.com/mixmark-io/turndown), 같은 설정)로 마크다운을 만듭니다. 티스토리 마크다운 모드에서 글을 다시 열었을 때와 거의 같은 모양이고, 머리줄 없는 표는 HTML 그대로 남습니다(GitHub에서는 표로 보입니다).
- **티스토리 이미지:** 이미지 주소가 매달 바뀌어 그대로 두면 링크가 깨지므로, 이미지 백업을 꺼도 티스토리 이미지는 저장소에 저장합니다.
- **티스토리에서 아직 안 되는 것:** 카테고리별 폴더, 글 관리 목록에서 여러 글을 한꺼번에 지우거나 공개 범위를 바꾸는 것, 개인 도메인 블로그.
- GitHub 토큰은 이 브라우저의 확장 저장소에만 보관됩니다. 완전히 끊으려면 GitHub → Settings → Applications에서 BlogHub 권한을 지우세요.
- 확장을 새로고침했다면 열려 있던 블로그 탭도 새로고침하세요.
- 개인정보처리방침: [PRIVACY.md](PRIVACY.md)

## 개발

1. GitHub OAuth App을 만듭니다: GitHub → Settings → Developer settings → OAuth Apps → New OAuth App
   - Homepage URL, Callback URL은 아무 주소나 괜찮습니다. (Device Flow에서는 쓰지 않음)
   - **Enable Device Flow**는 켜고, **Expire user access tokens**는 끕니다. (토큰 갱신에 비밀키가 필요해서)
2. 받은 Client ID를 `src/config.js`의 `CLIENT_ID`에 넣고, 위 **직접 불러오기**로 불러옵니다.
3. 테스트: `npm test` (Node 20 이상, 설치할 패키지 없음)
4. 스토어용 패키지: 커밋한 뒤 `npm run zip` (커밋된 파일만 들어갑니다)

```
manifest.json        확장 설정 (Manifest V3)
src/background.js    서비스 워커: 로그인, 저장소 연결, 글 커밋·삭제, 과거 글 가져오기
src/github.js        GitHub 인증(Device Flow)과 API, 여러 파일을 커밋 하나로 묶기
src/markdown.js      front matter, 파일·이미지 경로
src/content.js       블로그 페이지의 소식을 백그라운드로 넘기고 알림 표시
src/velog-hook.js    velog 페이지에서 출간·수정·삭제 요청을 가로챔
src/velog.js         velog 글 읽기 (GraphQL)
src/tistory-hook.js  티스토리 관리 화면에서 발행·수정·삭제 요청을 가로챔
src/tistory.js       티스토리 글 읽기, 이미지 자리표시자 처리
offscreen/           화면 없는 페이지: 티스토리 HTML → 마크다운 변환 (서비스 워커에는 DOM이 없어서)
offscreen/vendor/    turndown, turndown-plugin-gfm (MIT)
src/config.js        OAuth Client ID
popup/               확장 팝업 화면
icons/               아이콘 (icon.svg가 원본, PNG는 npm run icons로 다시 만듦)
```
