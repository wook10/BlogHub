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
- 시리즈별 폴더 (velog): 시리즈에 속한 글은 posts/시리즈명/ 폴더에 정리됩니다.
- 과거 글 가져오기: velog 아이디나 내 티스토리 블로그 아이디를 넣으면 지금까지 쓴 글을 한 번에 저장소로 가져옵니다.
- 비공개 글 선택: 비공개 글은 기본으로 저장하지 않고, 설정에서 켤 수 있습니다.

■ 사용 방법
1. 확장 아이콘을 누르고 "GitHub로 로그인"을 누릅니다.
2. 화면의 코드를 GitHub 페이지에 입력하고 승인합니다.
3. 글을 저장할 저장소를 고르거나 새로 만듭니다.
4. velog나 티스토리에서 평소처럼 글을 발행하면 끝입니다.

■ 개인정보
BlogHub는 별도 서버가 없습니다. GitHub 토큰은 브라우저 안에만 저장되고, 글은 GitHub와 velog·티스토리 사이에서만 오갑니다.
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
| Screenshots (1280×800) | `store/screenshot-1.png`, `store/screenshot-2.png` |

## Notes for certification (심사 담당자에게, 영어)

```
BlogHub saves posts that the user publishes on velog (https://velog.io) or Tistory (https://www.tistory.com), two Korean blog services, to a GitHub repository the user chooses.

How to test:
1. Click the toolbar icon and press "GitHub로 로그인" (Sign in with GitHub). A device code appears; enter it at https://github.com/login/device and approve. (GitHub OAuth Device Flow; no client secret is shipped).
2. In the popup, create or pick a repository.
3. Sign in to velog.io (any GitHub/Google account works), write a post and press "출간하기" (Publish).
4. A green "GitHub에 저장됨" (Saved to GitHub) toast appears and the post is committed to posts/<date>-<slug>.md.
Optional: "과거 글 가져오기" (Import past posts) in the popup imports all posts of a velog username, or of the user's own Tistory blog.
Tistory: sign in to tistory.com, open the blog's admin (https://<blog>.tistory.com/manage/newpost), publish a post (private is fine), then edit or delete it in the admin. Each action is committed to the repository as "[tistory] ...".

Permissions:
- storage: keeps the GitHub token, selected repository, settings and file paths locally.
- offscreen: a hidden page converts Tistory post HTML to Markdown locally with the bundled turndown library.
- Content scripts on velog.io: detect publish/edit/delete on velog. Only the post id is read; content is fetched again from velog's API.
- github.com / api.github.com: GitHub sign-in (Device Flow) and committing files.
- *.tistory.com: content scripts in the blog admin (/manage/*) detect publish/edit/delete (only the post number is read); the post is then read again from the admin's edit page with the user's own login.
- v2.velog.io: read the published post and the user's post list from velog's GraphQL API.
- velog.velcdn.com / images.velog.io / blog.kakaocdn.net: download post images to back them up.

The extension has no backend server and sends no data anywhere other than GitHub, velog and Tistory. No remote code is loaded.
```

## Availability

- Markets: 전체 (또는 대한민국만)
- Visibility: Public
