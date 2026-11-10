# BlogHub 개인정보처리방침 (Privacy Policy)

마지막 수정: 2026-11-10

BlogHub는 velog와 티스토리에 쓴 글을 사용자의 GitHub 저장소에 저장해 주는 브라우저 확장 프로그램입니다.
BlogHub는 개발자가 운영하는 서버가 없으며, 사용자 정보를 개발자에게 보내지 않습니다. 사용자가 직접 켠 AI 말투 바꾸기를 빼면 제3자에게도 보내지 않습니다.

## 다루는 정보

| 정보 | 쓰는 이유 | 저장 위치 |
| --- | --- | --- |
| GitHub 로그인 토큰, GitHub 아이디 | 사용자가 고른 저장소에 글을 커밋하기 위해 | 이 브라우저의 확장 저장소(`chrome.storage.local`) |
| 연결한 저장소 이름, 설정, 저장한 글의 파일 경로 | 같은 글을 수정·삭제할 때 같은 파일을 찾기 위해 | 이 브라우저의 확장 저장소 |
| velog·티스토리 글 (제목, 본문, 태그, 시리즈, 이미지) | 사용자의 GitHub 저장소에 저장하기 위해 | 사용자의 GitHub 저장소 |
| Gemini API 키 (사용자가 넣은 경우만) | 과거 글을 가져올 때 말투를 바꾸기 위해 | 이 브라우저의 확장 저장소 |
| 말투 설명 ("내 말투"를 고른 경우만) | 사용자 말투로 글을 바꾸기 위해 | 이 브라우저의 확장 저장소 |

## 정보가 오가는 곳

- **GitHub** (`github.com`, `api.github.com`): 로그인과, 사용자가 고른 저장소에 파일을 커밋할 때
- **velog** (`velog.io`, `v2.velog.io`, `velog.velcdn.com`, `images.velog.io`): 출간·수정·삭제를 알아차리고, 글 내용과 이미지를 받아올 때
- **티스토리** (`*.tistory.com`의 블로그 관리 화면, `blog.kakaocdn.net`): 발행·수정·삭제를 알아차리고, 글 내용과 이미지를 받아올 때
- **Google Gemini** (`generativelanguage.googleapis.com`): 사용자가 설정에서 말투 바꾸기를 켜고 API 키를 넣은 경우에만, 과거 글을 가져올 때 공개 글의 본문(코드·링크·이미지 주소는 빼고)을 보내 말투를 바꿉니다. "내 말투"를 고르면 사용자의 **공개** GitHub 저장소에 있는 마크다운 글 일부도 보내 말투를 분석합니다. 비공개 글과 비공개 저장소의 글은 보내지 않습니다. 사용자의 API 키로 요청하며, 무료 구간에 보낸 내용은 구글이 서비스 개선에 쓸 수 있다는 Google의 약관이 적용됩니다.

이 밖의 곳으로는 아무 정보도 보내지 않습니다. 광고, 분석 도구, 추적 코드를 쓰지 않습니다.

## 사용자가 할 수 있는 일

- 팝업에서 **로그아웃**하면 확장에 저장된 토큰과 저장소 정보가 지워집니다.
- GitHub → Settings → Applications에서 BlogHub 권한을 지우면 토큰이 더 이상 쓰이지 않습니다.
- 확장을 삭제하면 확장 저장소의 모든 정보가 지워집니다.
- 저장소에 올라간 글은 사용자의 GitHub 저장소에 있으므로 GitHub에서 직접 관리합니다.

## 문의

https://github.com/wook10/BlogHub/issues

---

## English

BlogHub is a browser extension that saves posts you write on velog and Tistory to your own GitHub repository.
BlogHub has no server of its own and never sends your data to the developer. Apart from the optional AI tone rewrite you turn on yourself, it sends nothing to third parties.

- **What it stores, locally in the browser (`chrome.storage.local`):** your GitHub access token and username, the repository you selected, your settings, and the file path of each saved post.
- **Where data goes:** only to GitHub (to sign in and commit files to the repository you chose) and to velog and Tistory (to detect publish, edit and delete actions and to read your post content and images).
- **Optional AI tone rewrite:** only if you turn on a tone setting and enter your own Gemini API key, the text of public posts you import (without code, links and image URLs) is sent to Google (`generativelanguage.googleapis.com`) to rewrite its tone. With "my tone", some Markdown files from your own public GitHub repositories are also sent to describe your writing style. Private posts and private repositories are never sent. Content sent on Google's free tier may be used by Google to improve its products, per Google's terms. The key and the style description are stored locally in the browser.
- **No tracking:** no ads, analytics or tracking code.
- **Control:** log out in the popup or remove the extension to delete local data; revoke BlogHub under GitHub → Settings → Applications to disable the token.
- **Contact:** https://github.com/wook10/BlogHub/issues
