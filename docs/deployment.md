# Windows Chrome에서 Prototype 0.1 테스트

Windows에는 Node.js나 별도 프로그램을 설치하지 않습니다. 배포가 완료되면 Chrome에서
아래 주소를 열어 사용합니다.

**배포 후 접속할 주소: <https://ju87-super.github.io/PocketScore/>**

이 주소는 배포 대상 주소이며, 문서에 주소가 있다는 사실만으로 배포 완료를 의미하지 않습니다.
아래 워크플로의 Deploy와 브라우저 검증이 모두 성공한 실행을 확인하세요.

## 공개 범위와 사용 조건

- 저장소는 Private으로 유지합니다. 워크플로는 저장소 공개 범위를 변경하지 않습니다.
- GitHub 개인 계정의 Private 저장소에서 Pages를 사용하려면 GitHub Pro가 필요합니다.
  현재 계정 요금제는 이 작업의 API 권한으로 확인할 수 없었습니다.
- 개인 계정의 Pages 사이트는 인터넷에 공개됩니다. Private 저장소에서도 배포된 HTML,
  JavaScript, CSS에는 누구나 접근할 수 있습니다. 저장소 Private과 사이트 비공개는 별개입니다.
- 로그인한 사람만 사이트를 열어야 한다면 이 개인 계정의 Pages 배포를 실행하지 마세요.
  비공개 Pages는 GitHub Enterprise Cloud 조직의 지원 기능이며, 개인 저장소를 공개로
  바꾸거나 다른 호스팅으로 전송하는 작업은 이 구성에 포함하지 않습니다.
- 현재 Codex 온보딩 도구에는 외부 미리보기 URL/포트 전달 발급 기능이 없습니다.
  localhost 주소는 Windows PC에서 접속할 수 있는 배포 주소가 아닙니다.

공식 근거:

- [Pages 사용 조건](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)
- [Pages 사이트 공개 범위](https://docs.github.com/en/pages/getting-started-with-github-pages/changing-the-visibility-of-your-github-pages-site)
- [사용자 정의 배포 워크플로](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)

## 저장소 소유자가 설정할 사항

1. 개인 계정의 현재 요금제가 Private 저장소의 Pages를 지원하는지 확인합니다.
   GitHub Free인 경우 저장소를 공개로 변경하지 말고, Pro 사용 여부를 결정해야 합니다.
2. 이 PR을 main에 병합합니다. 기존 `.github/workflows/ci.yml`의 Validate CI는 유지됩니다.
3. [저장소 Settings → Pages](https://github.com/ju87-super/PocketScore/settings/pages)에서
   **Build and deployment → Source → GitHub Actions**를 선택합니다.
   이 구성은 Pages를 자동 활성화하지 않습니다.
4. Actions가 허용되어 있어야 합니다. 배포 작업의 `GITHUB_TOKEN`에는 `contents: read`,
   `pages: write`, `id-token: write`가 필요하며 워크플로에 해당 최소 권한을 선언했습니다.
   별도 PAT나 토큰 값을 코드 또는 채팅에 입력하지 않습니다.
5. `github-pages` Environment에 승인자 또는 배포 브랜치 규칙이 있다면 main을 허용하고,
   실행 화면의 대기 중인 승인을 저장소 관리자가 처리합니다.

Codex 연결 앱으로 Pages 설정을 직접 조회·변경하려면 별도로 저장소의 **Pages: Read/Write**
권한이 필요합니다. 이 작업에서는 Pages 조회가 `Resource not accessible by integration`
(403)으로 거부됐습니다. 사용자가 위 설정을 웹에서 직접 완료하면 Codex 연결 앱에
Pages 쓰기 권한을 추가하지 않아도 배포 워크플로를 사용할 수 있습니다.

## 배포 실행과 성공 기준

1. [Actions](https://github.com/ju87-super/PocketScore/actions)에서 **Deploy GitHub Pages**를 선택합니다.
2. **Run workflow → Branch: main**을 선택합니다.
3. 사이트와 빌드된 JS가 공개됨을 허용할 경우에만 `confirm_public_site`를 선택하고 실행합니다.
   선택하지 않거나 main 이외 브랜치를 선택하면 게시 전에 실패합니다.
4. build 작업은 타입 검사, ESLint, Vitest, 프로덕션 빌드, 기존 Chromium 편집 테스트를
   모두 통과한 `dist/`만 업로드합니다. `/PocketScore/` Vite 경로는 그대로 사용합니다.
5. deploy 작업은 GitHub Pages에 배포한 뒤 실제 반환된 사이트 URL에 접속합니다.
   HTML과 `/PocketScore/assets/`의 JS·CSS HTTP 200, 악보 4마디, 내장 폰트,
   음높이 변경과 Undo 및 브라우저 예외 유무를 Playwright Chromium으로 확인합니다.
6. 전체 실행이 성공하고 `deployed-site-verification` 아티팩트의 스크린샷을 확인한 뒤
   Windows Chrome에서 위 주소를 엽니다. 새 main 커밋의 배포도 같은 수동 절차를 따릅니다.

추후 배포 URL만 다시 검사할 때 개발 환경에서 실행할 명령입니다.
Windows 테스트 사용자는 이 명령이나 Node.js 설치가 필요하지 않습니다.

```sh
POCKETSCORE_BASE_URL=https://ju87-super.github.io/PocketScore/ \
  npx playwright test --config tests/deployment/playwright.config.ts
```

Codex에서 공개 사이트를 검사할 경우 실행환경의 HTTPS 허용 목록에
`ju87-super.github.io`가 반영되어 있어야 합니다. 프록시 CONNECT 403은 GitHub 사이트의
HTTP 상태가 아니며, 이 경우 배포 성공으로 보고하지 않습니다.

## Windows Chrome 수동 테스트

1. 주소를 열고 PocketScore, Prototype 0.1, 4마디 악보 및 박자 검증 통과 표시를 확인합니다.
2. 편집 모드에서 첫 C4 음표를 위아래로 드래그하고 선택 정보의 음높이가 바뀌는지 확인합니다.
3. 음표나 쉼표를 가로로 드래그하고 길이 미리보기, 새 쉼표, 4/4 합계를 확인합니다.
4. 악보 영역에 포커스를 둔 상태에서 ↑↓, Shift+↑↓, ←→로 쉼표와 마디선까지 순회합니다.
5. Ctrl+Z와 Ctrl+Shift+Z로 복원하고, 드래그 중 Esc로 취소되는지 확인합니다.
6. 왼쪽 도구 막대를 펼치고 접습니다. 탐색 모드에서는 편집 대신 스크롤합니다.
7. 편집은 메모리에만 유지됩니다. 새로 고침하면 초기 악보로 돌아갑니다.

클라우드 검증은 Linux Chromium에서 수행합니다. 실제 Windows Chrome, 갤럭시 탭의
S펜·손가락 입력과 MuseScore GUI 동작은 직접 테스트하기 전까지 미검증입니다.
