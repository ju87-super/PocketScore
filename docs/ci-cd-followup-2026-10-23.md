# CI/CD 후속 검증 — 2026-10-23

날짜와 실행 시작 시각은 한국 시간(Asia/Seoul)입니다. main `8bc1021`과 열린 PR #2/#4를
확인한 후 기존 `ci/pocketscore-2-pipeline`에서 작업했습니다. main의 파일 내용은
Alpha `00b4b1f`와 같았습니다. 아래 정상 실행은 코드 커밋 `bad11f5`를 검증합니다.
이후 Chromium 설치의 단계 제한·로그 수집도 추가했고 최신 실행은 브랜치 목록에 남습니다.
PR 생성·base 변경·main 병합·Pages 배포·보호 정책 변경은 하지 않았습니다.

## 변경

- WASM 빌드의 preflight/toolchain/configure/compile/artifacts 상태를
  `build-status.json`·Markdown에 기록하고 실패 이후 단계는 `not_run`으로 남깁니다.
  실제 실패 exit code를 보존하고 마지막 로그를 GitHub 오류 annotation에도 남깁니다.
- 기존 Qt 검사는 버전 숫자가 없는 `Qt6CoreConfigVersion.cmake` 래퍼를 검사해 정상
  Qt도 거부했습니다. CMake가 생성된 `ConfigVersionImpl.cmake`의 실제 버전을 읽도록
  수정했습니다. 정확한 버전/잘못된 버전 테스트는 CMake가 있는 WASM 전용 작업에서 실행합니다.
- Emscripten의 CommonJS 출력과 upstream `install.js`가 PocketScore의 `type: module`을
  상속하는 문제를 해결했습니다. 별도 upstream 소스·빌드·보고서 디렉터리에만 Node
  package 경계를 생성하며 앱의 package.json/lockfile은 변경하지 않습니다. 기존
  manifest는 그대로 유지하고 충돌하는 ESM manifest는 덮어쓰지 않고 거부합니다.
- PR #4가 열린 이후 불필요해진 `ci/**` Push 검증을 제거했습니다. 필수 검증은
  PR·main Push·수동 실행으로 유지하고 같은 PR의 오래된 실행은 취소합니다.
  별도 브랜치 Push와 PR 이벤트로 같은 커밋을 두 번 검사하는 큐 낭비를 줄였습니다.
- 문서 커밋 검증 [39893399342](https://github.com/ju87-super/PocketScore/actions/runs/39893399342)의
  브라우저 작업이 Chromium 의존성 설치에서 오래 대기하는 것을 관찰했습니다. 테스트가
  실행되기 전의 설치 대기이며 이를 회귀 테스트 실패로 단정하지 않았습니다.
  일반 UI/오디오 job에 설치 단계 5분 제한과 `playwright-install.log`를 추가해, 향후
  설치 실패 시 job의 전체 timeout 전에 Artifacts로 원인을 남기도록 보완했습니다.

## 실제 Actions

| 실행 | 결과 | 시작 시각 | 소요 시간 |
| --- | --- | --- | --- |
| [최종 코드 PR CI](https://github.com/ju87-super/PocketScore/actions/runs/39892855823) | **success**, 필수 `check` 포함 8개 job 통과 | 12:02:36 | 1분 32초 |
| [WASM 첫 실제 시도](https://github.com/ju87-super/PocketScore/actions/runs/39890994954) | failure, 빌드 스크립트 실패. 단계별 진단 추가 전 | 11:42:02 | 2분 50초 |
| [WASM 단계 진단](https://github.com/ju87-super/PocketScore/actions/runs/39891569818) | failure, Qt 버전 검사 결함 확인 | 11:48:22 | 2분 20초 |
| [Qt 검사 수정 후](https://github.com/ju87-super/PocketScore/actions/runs/39892179624) | failure, 생성된 CommonJS의 ESM 범위 상속 확인 | 11:55:07 | 1분 38초 |
| [Node 범위 수정 후](https://github.com/ju87-super/PocketScore/actions/runs/39892601802) | **failure**, 실제 도구 체인 통과 후 upstream configure 오류 | 11:59:58 | 2분 12초 |

소요 시간은 Actions의 실행 시작부터 마지막 job 완료까지입니다. 병렬 job 시간을
합산하지 않습니다. 이후 문서 커밋 검증은 [PR 브랜치 실행 목록](https://github.com/ju87-super/PocketScore/actions?query=branch%3Aci%2Fpocketscore-2-pipeline)에서 확인할 수 있습니다.

WASM 수동 워크플로는 아직 main에 없어서 dispatch 요청이 404였습니다. main을 변경하지
않고 `ci/wasm-bootstrap-20261023` 임시 브랜치에 동일한 build/runtime 작업을 복제해
실행했습니다. 임시 워크플로는 검토 브랜치에 포함하지 않았고 실행 후 임시 브랜치를
정리했습니다. 정식 `musescore-wasm.yml`은 계속 `workflow_dispatch` 전용입니다.
이미 대체된 중복 검증의 취소를 성공으로 계산하지 않았습니다.

## WASM에서 확인한 범위

마지막 실제 실행은 다음을 통과한 뒤 **configure 단계에서 실패**했습니다.

1. MuseScore v4.7.5 소스 SHA `3654226c2e99289916916953a98e585a3d3b315a` 확인.
2. Qt WASM 6.10.2 패키지·도구 체인 경로와 실제 버전 확인.
3. Emscripten 4.0.7 버전 확인.
4. 작은 C 프로그램의 실제 WASM 컴파일 및 Node 실행(`EMSCRIPTEN_OK`).
5. MuseScore CMake 설정 시작 및 각 음악/화면 모듈 구성 진입.

실제 실패는 아래와 같습니다.

```text
CMake Error at src/web/appshell/CMakeLists.txt:21 (declare_module):
  Unknown CMake command "declare_module".
```

[고정 소스의 web appshell](https://github.com/musescore/MuseScore/blob/3654226c2e99289916916953a98e585a3d3b315a/src/web/appshell/CMakeLists.txt#L21)은
`declare_module`/`setup_module`을 사용하는데, 현재
[프레임워크 모듈 생성 API](https://github.com/musescore/MuseScore/blob/3654226c2e99289916916953a98e585a3d3b315a/src/framework/cmake/MuseCreateModule.cmake)는
`muse_create_module`입니다. 일반 appshell과 web appshell 사이의 모듈 정의도 다릅니다.
이 오류를 숨기기 위해 엔진을 빼거나 더미 WASM·임의의 다른 MuseScore 버전을 사용하지
않았습니다. 이번 CI 후속 작업에서 upstream C++/QML의 호환성 포팅은 하지 않았습니다.

**MuseScore 본체 컴파일·엔진 WASM 생성·브라우저 초기화·악보 읽기/편집/저장·재열기는
미검증입니다.** runtime job은 build 실패 때문에 `skipped`였고 전체 실험은 failure입니다.
C 검사 프로그램의 성공은 MuseScore 엔진 실행 성공이 아닙니다. 일반 PR CI의 필수
`check`는 이 실험에 의존하지 않으며 실제로 통과했습니다.

## 회귀 검증

- 타입 검사, ESLint, actionlint, production build, lockfile diff: 통과.
- Vitest: **197/197** 통과. 음악 데이터·입력·기존 앱 기능 코드는 변경하지 않았습니다.
- CI 계약·정적 probe·새 실패 보고/Node 범위 테스트: **28/28** 통과.
- CMake Qt 메타데이터 테스트: **2/2** 통과. 로컬 CMake 3.31.6과 실제 WASM job에서 확인.
  이 fixture는 패키지 메타데이터 검사 전용이며 실제 Qt/엔진을 대체하지 않습니다.
- 로컬 Chromium UI **37/37**(빌드 포함 65.764초), 실제 SF3 **4/4**(29.259초) 통과.
- 실제 PR CI에서 모든 필수 그룹과 `check` 통과. 기존 테스트 삭제·skip·실패 은폐는 없습니다.
- 기존 VexFlow/font 청크의 500KB 초과 경고는 그대로 남아 있습니다.

## 다음 단계와 현재 외부 조건

- 소유자가 PR #4의 base를 이미 병합된 Alpha 브랜치에서 **main**으로 바꾸고 최종 CI를
  검토하면 됩니다. PR 생성과 base 변경은 사용자에게 맡겼습니다.
- WASM 다음 개발 범위는 v4.7.5 web appshell의 모듈/C++/QML 호환성 수정입니다.
  수정한 소스와 patch provenance를 명시한 후 configure → 본체 compile → artifact →
  실제 브라우저 편집·저장·재열기를 차례로 통과시켜야 합니다. 그전에는 실험 상태를 유지합니다.
- 실제 Galaxy Tab/S Pen·청음·MuseScore GUI·Pages 배포 후 smoke는 이번에 수행하지 않았습니다.
- main의 이전 [통합 CI 실패](https://github.com/ju87-super/PocketScore/actions/runs/39718286481)는
  E2E 단계까지 확인했습니다. 서명된 로그 다운로드 호스트가 현재 네트워크에서 차단돼
  그 실패의 상세 원인은 단정하지 않습니다. 이 실패를 정상 실행으로 다시 보고하지 않았습니다.
- 클라우드 네트워크 초안에 `results-receiver.actions.githubusercontent.com`만 추가하고
  기존 `api.github.com` 및 package-manager presets를 보존했습니다. 저장은 완료됐지만
  실행 중 환경에 반영됐다고 주장하지 않습니다. 소유자가 환경 설정에서 검토·적용하면
  Actions 원본 로그 다운로드를 다시 확인할 수 있습니다. API annotations는 현재 읽을 수 있습니다.
- GitHub API 인증은 정상입니다. Codex Connector 앱의 `Administration` 부재 때문에
  main 보호 변경은 계속 소유자 설정이 필요하며 Pages 배포 여부와는 별개입니다.
  third-party Emscripten action의 Node 20 런타임 경고와 cache-service 경고도 관찰했습니다.
  이 경고를 WASM configure 실패 원인과 혼동하지 않습니다.
