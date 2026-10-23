# CI/CD 구축 검증 보고

이 문서는 2026-10-19 초기 구축 당시의 기록입니다. 이후 API 접근 복구·Alpha 병합·
실제 WASM 빌드 시도는 [2026-10-23 후속 보고](ci-cd-followup-2026-10-23.md)를 확인하세요.

검증일: 2026-10-19. main `8341e9ac09f2f791a28311ce4e97d577536c37ac`,
Alpha `00b4b1fd67a2dbd092ec2e434e8b3316413ec1dc`를 기준으로 별도
`ci/pocketscore-2-pipeline` 브랜치에서 작업했습니다. 검증한 최종 **코드** 커밋은
`7641b5e3008cc51573d9464141f8b48e6e44cfb9`이며 이 보고서는 후속 문서 커밋입니다.
기존 Alpha PR [#3](https://github.com/ju87-super/PocketScore/pull/3)과 WASM 조사 PR
[#2](https://github.com/ju87-super/PocketScore/pull/2)는 열린 상태를 확인했습니다.

## 구현한 워크플로

| 파일 | 결과 |
| --- | --- |
| `.github/workflows/ci.yml` | Validate: 품질, 음악, 입력, 결정적 재생, MusicXML, UI, 실제 음원 통합을 분리. 필수 `check` 유지 |
| `.github/workflows/deploy-pages.yml` | 성공한 main Push의 정확한 SHA만 후보. 명시적 활성화, 배포 전 artifact smoke와 배포 후 smoke |
| `.github/workflows/musescore-wasm.yml` | 수동 실험: 실제 Qt/Emscripten 빌드 후 별도 브라우저 초기화·MSCZ 편집·저장·재열기 |
| `.github/actions/setup-node/action.yml` | Node 24.19.0/npm 11.9.0 검증, npm 다운로드 캐시, npm ci, lockfile 일치 확인 |

일반 CI는 외부 비밀키 없이 실행했고 대형 SF3는 실제 오디오 검사에만 checkout했습니다.
시간 제한·중복 실행 취소·실패 로그·14일 Artifacts·JUnit/JSON/HTML·실패 screenshot/trace를
구현했습니다. 자동 재시도나 `continue-on-error`로 실패를 숨기지 않습니다.

## 실제 GitHub Actions 결과

| 실행 | 커밋 | 결과 | 총 소요 시간 |
| --- | --- | --- | --- |
| [최종 코드 정상 CI](https://github.com/ju87-super/PocketScore/actions/runs/39197730979) | `7641b5e` | **Success**, 필수 `check` 통과 | **1분 24초** |
| [최종 의도적 실패 검증](https://github.com/ju87-super/PocketScore/actions/runs/39197733189) | `cb8cd62` | **Failure**, 재생 테스트와 `check`만 실패 | **1분 19초** |
| [중간 정상 CI](https://github.com/ju87-super/PocketScore/actions/runs/39197121649) | `0316d57` | Success | 1분 26초 |
| [초기 CI](https://github.com/ju87-super/PocketScore/actions/runs/39196708146) | `54c5905` | 실제 오디오 통합 실패 | 2분 40초 |
| [초기 실패 검증](https://github.com/ju87-super/PocketScore/actions/runs/39196914926) | `8bde908` | 의도적 단위 테스트 실패 외 브라우저·오디오 실패도 발생 | 2분 32초 |
| [보완 중 실패 검증](https://github.com/ju87-super/PocketScore/actions/runs/39197333452) | `4bb5208` | 의도적 실패 외 SVG 준비·짧은 오디오 관찰 실패 발견 | 2분 44초 |

최종 정상 실행의 Code Quality 35초, Browser E2E 1분 6초(UI 테스트 자체 24.0초),
SoundFont Integration 1분 16초(테스트 자체 25.2초), aggregate `check` 3초입니다.
각 작업은 병렬이므로 소요 시간을 단순 합산하면 전체 시간과 다릅니다.
정상/의도적 실패 실행 모두 7개 Artifacts가 생성됐습니다. 정상 실행 브라우저 보고서
583KB, 오디오 보고서 204KB이며 원본 음원은 업로드하지 않았습니다.

최종 실패 검증은 음악·입력·MusicXML·품질과 UI 37/37·오디오 4/4가 모두 통과한 가운데
임시 `src/playback/ci-failure-probe.test.ts`의 실패를 실제 GitHub가 검출했습니다.
aggregate `check`도 실패했습니다. 이 테스트는 검토 브랜치에 포함하지 않았으며,
검증 전용 임시 브랜치는 기록을 남긴 뒤 정리했습니다. 실행 기록과 커밋 링크는 위에 남습니다.
별도로 실제 aggregate 스크립트의 failure/cancelled/skipped/missing 거부와 보고기의
exit 17 전달도 결정적 테스트로 확인했습니다.

중간 실패를 단순 재실행으로 처리하지 않았습니다. 실제 오디오 검사를 단일 worker로
분리하고, SVG 교체 중에는 좌표가 준비될 때까지 대기하며 제스처는 한 번만 보냅니다.
악기별 가져오기 완료를 기다리고 재생 전부터 실제 출력 미터의 모든 갱신을 기록해
짧은 PCM transient의 누락을 방지했습니다. 악기별 peak/sample JSON도 보고서에 첨부합니다.
초기 실행의 인증된 상세 로그는 이 환경에서 열람하지 못했으므로 초기 오디오 실패의
원인이 모두 동일했다고 단정하지 않습니다.

문서 커밋을 포함한 이후 실행은 [브랜치 Actions 목록](https://github.com/ju87-super/PocketScore/actions?query=branch%3Aci%2Fpocketscore-2-pipeline)에서 확인할 수 있습니다.

## 자동화 범위와 로컬 검증

| 범위 | 결과 | 로컬 명령 전체 소요 시간 |
| --- | --- | --- |
| Music Engine | 171/171: 분수·박자 합·쉼표/음표 길이·성부·화음·마디 구조·조표/박자·Undo/Redo·불변식 | 3.777초 |
| Input & Gesture 단위 | 17/17: reducer·의도/축·취소·입력 포커스 | 2.399초 |
| 결정적 Playback | 3/3: 정확한 tick/초·템포·동시 악기/화음·쉼표·길이·mute/solo·볼륨/팬 MIDI | 0.984초 |
| MusicXML fixtures | 6/6: 악기/오선/성부/음높이/길이·조표/박자·round-trip·오류/미지원 진단 | 2.065초 |
| CI 계약 + 기존 WASM 정적 probe | 22/22 | 품질 작업 안에 포함 |
| Code Quality | actionlint·타입·린트·빌드·lockfile 모두 통과 | 15.653초 |
| Chromium UI | 37/37, skipped 0, retries 0 | 빌드 포함 72.827초 |
| 실제 SF3 통합 | 4/4, skipped 0, retries 0 | 자산 확인·빌드 포함 40.147초 |
| 배포 전 로컬 production smoke | 1/1, 올바른 SHA·base·asset hash/MIME·SPA·폰트·키보드·Undo | 5.667초 |

Vitest 총 **197/197**이며 기존 188개에 9개를 추가했습니다. 브라우저는 기존 33개에
8개를 추가한 **41개(UI 37 + 오디오 4)**입니다. 기존 테스트를 삭제하지 않았습니다.
새 UI 시나리오는 네 방향 CDP 펜, 다중 접촉 격리, 390×844/800×1280/1280×800의
새 악보·입력·수정·악기 추가·저장·재열기입니다. 기존 방향키/반음 이동·취소·재생/정지
시나리오도 유지했습니다. 실제 음원 테스트는 pause/seek/stop/restart, 음원 실패/재시도,
4악기 각각의 PCM, loop/metronome을 검사합니다.

로컬 환경은 Linux Chromium 154.0.8037.57입니다. GitHub는 잠긴 Playwright 버전이
설치한 Chromium을 사용했습니다. SF3 파일을 제외한 상태에서도 품질·UI가 통과함을
별도로 검증했습니다. 고정 ensemble/key-meter fixtures 두 개는 MusicXML 4.0 XSD로도
로컬 검증했습니다. CI의 상시 검사는 MusicXML 실제 가져오기/내보내기·의미 비교입니다.

## 아직 검증하지 않은 항목

- 연음표·붙임줄의 편집/재생/round-trip 지원: 현재 미구현. fixture는 명시적 거부와
  기존 프로젝트 보존을 검증하며 지원 성공으로 계산하지 않습니다.
- 실제 Galaxy Tab/S Pen, 물리 멀티터치, 실제 스피커/헤드폰의 출력·음색 청음,
  MuseScore GUI 호환성: 수행하지 않았습니다.
- 실제 Qt/Emscripten WASM 빌드·엔진 런타임: 이번 환경에서 수행하지 않았습니다.
  정적 probe·테스트 발견·타입 검사는 엔진 실행 성공의 증거가 아닙니다.
- 실제 Pages 배포와 배포 후 원격 smoke: 수행하지 않았습니다. 로컬 smoke만 통과했습니다.
- Rulesets/Branch Protection의 실제 강제 적용: API 접근이 차단돼 현재 권한·요금제 지원·
  기존 정책을 확인하거나 적용하지 못했습니다. 초안 `.github/rulesets/main.json`을 제공합니다.
- 기존 VexFlow 포함 청크의 500KB 초과 경고는 남아 있습니다. production build는 통과하며
  이번 CI 변경에서 경고 한도를 높이거나 실패를 숨기지 않았습니다.

## WASM 후속 실행 계획

워크플로가 default branch에 포함되면 Actions에서 `Experimental MuseScore WASM`을
수동 실행하세요. v4.7.5 정확한 소스 SHA, Qt 6.10.2, Emscripten 4.0.7을 고정했습니다.
컴파일러 smoke → 실제 app-web 빌드 → PR #2 정적 probe → 브라우저 WASM compile/MIME →
Qt 초기화 → 고정 MSCZ 로드 → C4→D4 편집·저장 → 재열기·D4→C4 데이터 비교 순입니다.
실패/미실행 단계는 별도로 보고하며 런타임이 준비되지 않으면 실패합니다.
첫 실제 빌드 로그로 의존성을 안정화하고 공개 C++ 편집·serialize bridge를 마련한 후
관련 기능을 필수 검사로 승격하세요. 일반 TypeScript PR은 실험 빌드에 의존하지 않습니다.

## PR과 필요한 사용자 설정

브랜치 Commit/Push를 완료했습니다. GitHub API CONNECT/요청의 **403 Forbidden** 때문에
`gh pr create`는 실패했습니다. 저장소 조회·main protection·rulesets·Pages API도 동일하게
차단됐습니다. 이 결과로 계정의 저장소 권한이나 요금제 지원 여부를 판단할 수 없습니다.
Git Push와 공개 GitHub 웹의 실제 run 상태·annotations·시간·Artifacts 목록 확인은 가능했습니다.

1. [CI PR 생성 화면](https://github.com/ju87-super/PocketScore/compare/feat%2Fpocketscore-2-alpha...ci%2Fpocketscore-2-pipeline?expand=1)에서
   base `feat/pocketscore-2-alpha`, head `ci/pocketscore-2-pipeline`으로 생성하고
   [PR 본문](ci-cd-pr.md)을 사용하세요. Alpha PR #3 병합 후 필요하면 base를 main으로 변경하세요.
2. Settings → Rules → Rulesets 또는 Branches → Branch Protection에서 main에 PR 병합과
   필수 검사 **`check`**, 최신 커밋 검증을 적용하세요. 기능 지원과 관리 권한은 소유자가
   확인해야 합니다. 새 Push마다 PR CI가 재실행됩니다.
3. 배포를 시작할 때 Pages Source **GitHub Actions**, `github-pages` environment의
   main 브랜치 제한/필요한 승인, Actions 실행 권한을 확인한 뒤 repository variable
   **`ENABLE_PAGES_CD=true`**를 설정하세요. 이후 성공한 main Push CI가 CD를 시작합니다.
4. 클라우드 설정 초안에는 `api.github.com` 허용 도메인만 추가해 저장했습니다.
   실행 중 환경에는 반영되지 않았으므로 환경 설정을 검토·게시한 뒤 새 세션에서
   API 작업을 재시도해야 합니다. 채팅에 토큰을 전달할 필요는 없습니다.

main 병합, 저장소 공개 범위 변경, Pages 설정 변경/실제 배포, 보호 정책 적용은
이번 작업에서 수행하지 않았습니다. 운영 명령과 정책은 [CI/CD 안내](ci-cd.md)에 있습니다.
