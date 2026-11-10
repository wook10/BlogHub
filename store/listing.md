# Microsoft Edge 추가 기능 스토어 등록 자료

Partner Center(https://partner.microsoft.com/dashboard/microsoftedge)에서 새 확장을 만들 때 아래 내용을 붙여 넣는다.

## 패키지

- `npm run zip` → `bloghub.zip` 업로드 (커밋된 manifest.json, src, popup, icons만 들어간다)
- 올리기 전에 커밋을 먼저 할 것. 커밋 안 된 수정은 zip에 들어가지 않는다.

## Properties

| 항목 | 값 |
| --- | --- |
| Category | Developer tools (없으면 Productivity) |
| Privacy policy required | Yes |
| Privacy policy URL | https://github.com/wook10/BlogHub/blob/main/PRIVACY.md |
| Website | https://github.com/wook10/BlogHub |
| Support contact | https://github.com/wook10/BlogHub/issues |
| Mature content | No |

## Store listing (Korean)

**Display name**

```
BlogHub
```

**Short description**

```
velog·티스토리에 글을 발행하면 GitHub 저장소에 마크다운으로 자동 커밋해 줍니다.
```

**Description**

```
BlogHub는 velog나 티스토리에 글을 발행하는 순간, 그 글을 내 GitHub 저장소에 자동으로 커밋해 주는 확장 프로그램입니다.
백준허브가 알고리즘 풀이를 GitHub에 올려 주듯, BlogHub는 블로그 글을 GitHub에 올려 줍니다.

■ 주요 기능
- 발행 즉시 커밋: velog의 "출간하기", 티스토리의 발행을 누르면 바로 GitHub에 저장됩니다. 임시저장은 커밋하지 않습니다.
- 마크다운으로 저장: velog는 직접 쓴 마크다운 그대로, 티스토리는 HTML을 마크다운으로 바꿔 제목, 날짜, 태그, 글 주소와 함께 저장합니다.
- 수정·삭제 반영: 글을 고치면 같은 파일을 업데이트하고, 블로그에서 지우면 저장소에서도 지웁니다.
- 이미지 백업: 글에 들어간 블로그 이미지를 저장소에 함께 저장하고 링크를 저장소 경로로 바꿉니다.
- 저장 폴더: 저장소에 있는 폴더를 고르거나 새로 만들 수 있습니다. 그 안에서 velog 글은 시리즈별, 티스토리 글은 카테고리별 폴더로 정리됩니다.
- 과거 글 가져오기: velog 아이디나 내 티스토리 블로그 아이디를 넣으면 지금까지 쓴 글을 한 번에, 또는 목록에서 골라 하나씩 저장소로 가져옵니다.
- 말투 바꿔 가져오기 (선택): 과거 글을 1인칭, 3인칭, 내 말투로 바꿔 저장합니다. 사용자 본인의 무료 Gemini API 키가 필요합니다. 비공개 글은 보내지 않습니다.
- 비공개 글 선택: 비공개 글은 기본으로 저장하지 않고, 설정에서 켤 수 있습니다.

■ 사용 방법
1. 확장 아이콘을 누르고 "GitHub로 로그인"을 누릅니다.
2. 화면의 코드를 GitHub 페이지에 입력하고 승인합니다.
3. 글을 저장할 저장소를 고르거나 새로 만듭니다.
4. velog나 티스토리에서 평소처럼 글을 발행하면 끝입니다.

■ 개인정보
BlogHub는 별도 서버가 없습니다. GitHub 토큰은 브라우저 안에만 저장되고, 글은 GitHub와 velog·티스토리 사이에서만 오갑니다.
단, 말투 바꾸기를 직접 켜고 API 키를 넣은 경우에만 가져오는 공개 글의 본문이 구글 Gemini로 전송됩니다 (무료 구간에 보낸 글은 구글이 서비스 개선에 쓸 수 있습니다).
광고, 분석, 추적 코드를 쓰지 않습니다.

BlogHub는 velog나 티스토리의 공식 확장이 아닙니다. 소스 코드: https://github.com/wook10/BlogHub
```

**Search terms** (하나씩 입력)

```
velog
티스토리
GitHub
블로그 백업
마크다운
자동 커밋
잔디
```

**Images**

| 항목 | 파일 |
| --- | --- |
| Store logo (300×300) | `store/logo-300.png` |
| Small promotional tile (440×280) | `store/promo-440x280.png` |
| Screenshots (1280×800) | `store/screenshot-1.png`, `store/screenshot-2.png`, `store/screenshot-3.png` |

## Notes for certification (심사 담당자에게, 영어)

```
BlogHub saves posts that the user publishes on velog (https://velog.io) or Tistory (https://www.tistory.com), two Korean blog services, to the user's GitHub repository.

How to test:
1. Click the toolbar icon and press "GitHub로 로그인" (Sign in with GitHub). A device code appears; enter it at https://github.com/login/device and approve (Device Flow).
2. In the popup, create or pick a repository and a folder.
3. Sign in to velog.io, write a post and press "출간하기" (Publish).
4. A "GitHub에 저장됨" (Saved) toast appears and the post is committed to the chosen folder.
Optional: import past posts from the popup.
Tistory: sign in to tistory.com, publish a post in the blog admin (https://<blog>.tistory.com/manage/newpost), then edit or delete it. Each action is committed as "[tistory] ...".

Optional tone setting (off by default, gear icon): the user can pick a tone for imported past posts and enter their own Gemini API key. Only then is the text of imported public posts sent to generativelanguage.googleapis.com to rewrite its tone. Private posts are never sent.

Permissions:
- storage: GitHub token, repository, settings, file paths (local only).
- offscreen: hidden page converts Tistory HTML to Markdown locally with the bundled turndown library.
- velog.io: content scripts detect publish/edit/delete (only the post id is read); content is fetched from velog's API.
- github.com / api.github.com: sign-in and commits.
- *.tistory.com: content scripts in the blog admin (/manage/*) detect publish/edit/delete; the post is re-read from the admin edit page with the user's login.
- v2.velog.io: read posts from velog's GraphQL API.
- velog.velcdn.com / images.velog.io / blog.kakaocdn.net: post images for backup.
- generativelanguage.googleapis.com: only the optional tone rewrite above.

No backend server. Apart from the optional tone setting, no data is sent anywhere other than GitHub, velog and Tistory. No remote code is loaded.
```

## Availability

- Markets: 전체 (또는 대한민국만)
- Visibility: Public
