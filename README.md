# VelogHub

velog에 글을 출간하면 GitHub 저장소에 자동으로 커밋해 주는 크롬 확장 프로그램입니다.

## 개발 환경 설정

1. GitHub OAuth App 만들기: GitHub → Settings → Developer settings → OAuth Apps → New OAuth App
   - Homepage URL, Callback URL: 아무 주소나 입력 (Device Flow에서는 쓰지 않음)
   - 만든 뒤 **Enable Device Flow**를 체크
2. 받은 Client ID를 `src/config.js`의 `CLIENT_ID`에 넣기
3. `chrome://extensions` → 개발자 모드 켜기 → "압축해제된 확장 프로그램 로드" → 이 폴더 선택

## 구조

```
manifest.json      확장 설정 (Manifest V3)
src/background.js  서비스 워커: 로그인, 저장소 연결, 출간된 글 커밋
src/github.js      GitHub 인증(Device Flow)과 API 호출
src/velog-hook.js  velog 페이지에서 출간 요청을 가로챔 (velog 요청 형식은 여기에만 있음)
src/content.js     출간 소식을 백그라운드로 넘기고 "GitHub에 저장됨" 알림 표시
src/markdown.js    front matter를 붙인 마크다운, 파일·이미지 경로 만들기
src/velog.js       과거 글 전체 불러오기 (velog GraphQL)
src/config.js      OAuth Client ID
popup/             확장 팝업 화면
tests/             node --test 로 실행
```

## 테스트

```
npm test
```
