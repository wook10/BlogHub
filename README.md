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
src/background.js  서비스 워커: 로그인, 저장소 요청 처리
src/github.js      GitHub 인증(Device Flow)과 API 호출
src/config.js      OAuth Client ID
popup/             확장 팝업 화면
tests/             node --test 로 실행
```

## 테스트

```
npm test
```
