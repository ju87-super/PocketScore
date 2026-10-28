# PocketScore 2.0 CI/CD

## 기준과 변경 범위

2026-10-19 기준 main `8341e9a`, Alpha `00b4b1f`에서 시작했습니다.
별도 `ci/pocketscore-2-pipeline` 브랜치이며 Alpha 기능 코드는 변경하지 않습니다.
검토 PR의 초기 base는 `feat/pocketscore-2-alpha`였습니다. 2026-10-22에 Alpha PR
[#3](https://github.com/ju87-super/PocketScore/pull/3)이 main `8bc1021`에 병합됐습니다.
현재 CI PR [#4](https://github.com/ju87-super/PocketScore/pull/4)는 열려 있으며, 소유자가
base를 main으로 변경하면 됩니다. 여기서 main 병합·PR 생성·저장소 공개 범위·보호 규칙·
Pages 설정 변경을 수행하지 않습니다.

## 필수 CI: Validate

PR, main Push, 수동 실행에서 동작합니다. 초기 PR API 차단 시 사용했던 `ci/**` Push
부트스트랩은 PR #4가 열린 뒤 제거했습니다. feature Push와 PR 이벤트가 같은 커밋의
필수 검사를 중복 실행하지 않습니다. 같은 PR/브랜치의 이전 실행은 취소하며,
필수 검사 이름 **`check`**는 기존 이름을 유지합니다.

| 검사 | 실행 내용 | timeout |
| --- | --- | --- |
| Code Quality | 고정 Node/npm, npm ci, lockfile diff, actionlint, CI 정책/실패 경로, 타입·린트·production build | 12분 |
| Music Engine Tests | 기존 분수·박자·길이·쉼표·조표·박자·성부·화음·구조·Undo 불변식 | 10분 |
| Input and Gesture Tests | reducer·제스처 의도·포커스 단위 테스트 | 10분 |
| Playback Timing Tests | 음원 없는 결정적 tick/초/템포/성부/화음/쉼표/라우팅·뮤트/솔로 | 10분 |
| MusicXML Compatibility | 고정 XML fixtures, 가져오기/내보내기/round-trip·조표·박자·진단 | 10분 |
| Browser E2E | 기존/Alpha UI, 네 방향 펜·키보드·취소·다중 접촉·390/800/1280 레이아웃·저장/재로드 | 18분 |
| SoundFont Integration | 실제 검증된 MS Basic PCM, 4악기, pause/seek/stop/restart/loop/metronome/retry | 18분 |
| check | 위 작업 **전부 success**일 때만 통과. 실패·취소·생략·누락은 실패 | 3분 |

matrix는 `fail-fast: false`로 다른 음악 검사의 결과도 남깁니다.
`continue-on-error`와 자동 재시도를 사용하지 않습니다. Playwright는 `.only`를 CI에서
거부하고, 실패 screenshot·trace, HTML/JUnit/JSON을 남깁니다.
브라우저·음원, Pages 사전/배포 후 smoke와 WASM runtime은 같은 공식 Playwright
Noble 컨테이너를 버전과 manifest digest로 고정합니다. 브라우저·OS 패키지가 이미지에
포함돼 매번 Ubuntu 미러에서 `apt`/`playwright install --with-deps`를 실행하지 않습니다.
`verify-browser`는 2분 제한 안에 Chromium을 실제 실행하고 페이지를 열어
`reports/setup/browser-runtime.json`과 `.log`, Step Summary에 버전·시간·실패 이유를
남깁니다. 이 사전 검사는 기능·오디오 검사를 대체하지 않습니다.

`.github/actions/setup-node`는 `.nvmrc`와 `packageManager`의 정확한 버전을 검사하고
필요하면 고정 npm을 설치합니다. setup-node의 npm 다운로드 캐시를 사용하고
`node_modules`를 캐시하지 않습니다. 앱 비밀키나 외부 서비스는 필요하지 않습니다.

일반 작업은 sparse checkout으로 `public/audio/*.sf3`를 제외합니다. 실제 PCM을
검증하는 SoundFont Integration만 51.3MB 파일이 필요합니다. 소스 음원이나 dist를
일반 CI Artifacts에 업로드하지 않습니다. 음색의 인간 청음과 물리 태블릿 검사는
자동 PCM·에뮬레이션 검사와 구별합니다.

## 실행과 결과

```sh
npm ci
npm run ci:quality
npm run ci:music
npm run ci:input
npm run ci:playback
npm run ci:musicxml
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run ci:browser
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run ci:audio
```

GitHub browser job은 이미지의 고정 Chromium을 사용하므로 executable override를 쓰지
않습니다. `npm test`와 `npm run test:e2e`도 기존 전체 검증 진입점으로 유지됩니다.
`tools/ci/inventory.mjs`는 단위 테스트 파일이 필수 그룹에서 누락되면 실패합니다.
기존 결합 project 테스트도 음악 그룹에 그대로 유지합니다.

`reports/<suite>/`에는 명령별 로그, exit code·시간·passed/failed/skipped 수의 JSON,
Markdown과 JUnit/브라우저 보고서가 생성됩니다. 생성할 때 이전 결과를 지우므로
오래된 성공 결과로 덮지 않습니다. GitHub Step Summary와 14일 보존 Artifacts에서
결과를 확인합니다. 실행 중 강제 runner 종료 시에는 로그 업로드 자체가 불가능할 수 있습니다.
이미지 pull은 checkout 전에 실행되므로 pull 자체가 실패하면 저장소의 진단 스크립트나
Artifacts 업로드는 실행할 수 없습니다. 그 경우 Actions의 Initialize containers 로그를
확인합니다. 이미지 다운로드와 npm registry 접속에 대한 네트워크 의존은 남습니다.

Playwright를 올릴 때는 package.json/lockfile, 5개 browser job의 이미지 버전·digest를
함께 갱신합니다. CI 계약 검사는 서로 다른 이미지, 버전 불일치, digest 누락과 설치
명령 재도입을 거부합니다. [전환 근거와 검증 보고](ci-browser-container.md)를 참조하세요.

실패 검증은 실제 `check` 스크립트를 success/failure/cancelled/skipped/missing 입력으로
실행하고, 하위 프로세스가 exit 17인 경우 보고기 역시 17을 반환하는지 검사합니다.
수동 Validate의 `failure_probe=true`는 의도적으로 Code Quality를 실패시키는 기능입니다.
이 실행이 실패하고 CD가 배포하지 않는지 GitHub에서 확인하세요. 실패를 성공으로 바꾸지 않습니다.

연음표·붙임줄의 편집/재생은 현재 미구현입니다. 고정 `tuplet.musicxml`·`tied.musicxml`은
명시적 거부만 검사합니다. `it.skip`/dummy 성공을 추가해 지원한다고 주장하지 않습니다.
구현할 때 모델·재생·round-trip의 실제 기대값 테스트를 추가해 해당 필수 그룹에 포함하세요.

## CD: Deploy GitHub Pages

`Validate` 완료 이벤트 중 **동일 저장소 main Push 성공**만 후보입니다. fork/PR/실패/
feature/잘못된 SHA는 제외하고, `ENABLE_PAGES_CD=true`를 소유자가 설정해야 배포합니다.
꺼져 있으면 요약에 **NOT DEPLOYED**와 이유를 남깁니다.

검증된 `head_sha`를 정확히 checkout해 production build를 만들고 현재 main SHA도
빌드 전·배포 직전에 확인합니다. 오래된 성공 실행이 더 최신 main을 덮지 않도록 합니다.
PR 실행의 artifact나 스크립트를 권한 높은 workflow_run에서 실행하지 않습니다.
`pages:write`/`id-token:write`는 `github-pages` environment를 쓰는 deploy job에만 줍니다.

`pages-build.mjs`는 `/PocketScore/` JS/CSS의 실제 바이트/해시와 음원 해시를 확인하고
`build-info.json`에 소스 SHA를 남깁니다. `legacy/index.html`, `404.html`, `.nojekyll`도
생성합니다. 배포 전 정확한 artifact의 smoke가 통과해야 upload/deploy로 진행합니다.
배포 후에는 실제 deployment URL에서 동일 SHA·asset 해시/MIME·음원 HEAD·폰트·악보
편집·Undo·deep link를 검사합니다. Pages의 알 수 없는 SPA 경로는 HTTP 404로 앱을
부트할 수 있으며 이 상태를 HTTP 200이라고 보고하지 않습니다.

로컬 배포 전 smoke 재현:

```sh
npm run build
node tools/ci/pages-build.mjs dist
POCKETSCORE_EXPECTED_SHA=$(git rev-parse HEAD) PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npx playwright test --config tests/deployment/local.config.ts
```

이는 **로컬 artifact 검증**이며 실제 Pages 배포 성공을 뜻하지 않습니다.

## 실험적 MuseScore WASM

`Experimental MuseScore WASM`은 `workflow_dispatch` 전용이며 `check`와 무관합니다.
워크플로가 default branch에 포함된 후 Actions에서 실행할 수 있습니다.

- MuseScore v4.7.5의 정확한 `3654226c2e99289916916953a98e585a3d3b315a`를 checkout.
- 실제 upstream wasm workflow/setup과 같은 Qt **6.10.2**, Emscripten **4.0.7** 사용.
- 컴파일러 버전·Qt package 검사, C→WASM 컴파일 및 Node 실행, app-web CMake/Ninja build.
- PR #2의 정적 artifact probe는 별도 `ARTIFACTS_PRESENT_NOT_RUNTIME_VERIFIED`로 기록.
- 실제 엔진 archive를 브라우저 job으로 전달해 WASM compile/MIME, Qt canvas 초기화,
  고정 MSCZ 로드, Qt 키보드 C4→D4 편집·저장, 재로드·D4→C4 저장 데이터를 검사.
- 각 단계는 `passed`/`failed`/`not_run`으로 기록합니다. 저장 callback이나 Qt 키보드
  동작이 준비되지 않았으면 실패하며 가짜 bridge/fixture WASM으로 통과시키지 않습니다.
- `build-status.json`은 preflight/toolchain/configure/compile/artifacts를 구분합니다.
  실패 exit code를 보존하고 뒤 단계는 `not_run`으로 남깁니다. 실패한 단계의 마지막
  로그는 GitHub 오류 annotation에도 기록해 artifact를 열지 않아도 원인을 확인할 수 있습니다.
- 공개 편집 JS API가 없어 실제 Qt 키보드를 쓰는 **미검증 실험 경로**입니다.
  2026-10-23 실제 Actions에서 Qt/Emscripten과 C→WASM 실행 검사는 통과했지만,
  v4.7.5 web appshell의 `Unknown CMake command "declare_module"`로 configure가
  실패했습니다. MuseScore 엔진 산출물·브라우저 실행·편집/저장은 검증하지 못했습니다.
- build timeout 120분, runtime 15분, 병렬 컴파일 2개. 결과/trace는 보존하되 일반 PR을
  이 실험의 toolchain 실패로 막지 않습니다. GitHub에서 처음 실행한 로그로 의존성을
  안정화한 뒤, 장기적으로 명시적인 C++ 편집/serialize bridge로 대체합니다.

## 소유자가 적용할 설정

1. Actions에서 워크플로 실행을 허용합니다. main 보호 필수 검사에 **`check`**를 지정하고
   최신 커밋 검증을 요구하세요. `.github/rulesets/main.json`은 적용 가능한 초안이며
   자동 적용됐다고 주장하지 않습니다. 요금제/권한에 따라 Rulesets 또는 classic
   Branch Protection을 사용하세요. 승인 리뷰 수는 기본 0이며 필요하면 높이세요.
2. Pages Source를 **GitHub Actions**로 설정하고, 해당 공개 범위/계정 요금제에서 Pages를
   지원하는지 확인하세요. `github-pages` environment의 배포 브랜치를 main으로 제한하고
   필요한 승인 정책을 적용한 뒤 repository variable `ENABLE_PAGES_CD=true`를 설정하세요.
   이 작업에서는 Pages 설정 변경이나 실제 배포를 실행하지 않습니다.
3. GitHub API의 CONNECT가 403이면 클라우드 네트워크의 `api.github.com` 허용 여부를
   확인하세요. 2026-10-23에는 이 연결과 PR/Actions API 인증이 정상입니다. 로그 다운로드는
   별도 `results-receiver.actions.githubusercontent.com`을 사용하며 이 도메인의 허용 초안을
   추가 저장했습니다. 초안 저장만으로 실행 중 환경이 바뀌지는 않습니다.
4. `Resource not accessible by integration`은 네트워크 오류와 구분하세요. 현재 OpenAI의
   ChatGPT Codex Connector 설치 권한과 공개 앱 권한에는 `Administration`이 없습니다.
   main 보호 조회에 필요한 `administration=read`를 충족하지 못하며 GraphQL도 거부됩니다.
   사용자 ADMIN 역할·Pages 배포와 별개이고, 재승인으로 추가할 요청 자체가 없습니다.
   소유자가 GitHub 설정에서 보호 정책을 직접 적용해야 합니다. Git 프록시 인증은
   재사용하며 채팅에 토큰을 보내지 마세요.

최종 실행 수치·시간·원격 실행 링크/차단 사항은 [검증 보고](ci-cd-results.md)에 기록합니다.
2026-10-23 이후 실제 WASM 빌드 시도와 후속 검증은 [후속 보고](ci-cd-followup-2026-10-23.md)를 확인하세요.
