## 변경

기존 단일 CI 작업을 Code Quality, Music Engine, Input & Gesture, 결정적 Playback,
MusicXML, Chromium E2E, 실제 SF3 통합 검사로 나누고 기존 필수 검사 이름 `check`를
유지합니다. 실패·취소·생략·누락을 통과시키지 않으며 로그/JUnit/JSON/HTML과 실패
스크린샷·trace를 Artifacts에 보존합니다. 일반 작업은 대형 SF3를 checkout하지 않습니다.

기존 테스트를 유지하고 음악·MusicXML 단위 테스트 9개와 브라우저 시나리오 8개를
추가했습니다. 네 방향 펜, 다중 접촉, 모바일/태블릿 레이아웃, 저장/재로드를 검사하며
짧은 PCM 출력은 재생 전부터 모든 미터 갱신을 기록합니다. CI 계약과 실패 전달도 검사합니다.

Pages CD는 같은 저장소의 검증된 main Push SHA만 배포 대상으로 삼고,
`ENABLE_PAGES_CD=true` 설정이 있어야 동작합니다. 배포 전후 `/PocketScore/`·정적 자산·
SPA·편집 smoke를 검사합니다. 실제 배포나 저장소 설정 변경은 수행하지 않았습니다.

MuseScore v4.7.5/Qt 6.10.2/Emscripten 4.0.7의 실제 빌드와 브라우저 편집·저장·재열기를
요구하는 수동 WASM 워크플로를 별도로 추가했습니다. 정적 artifact probe와 런타임 증거를
구분하며 일반 TypeScript PR의 필수 검사에 포함하지 않습니다.

## 검증

- 타입 검사, ESLint, production build, actionlint 통과.
- Vitest 197/197, CI 정책·기존 probe 22/22, Chromium UI 37/37 + 실제 SF3 4/4 통과.
- 로컬 production artifact smoke 1/1 통과. 일반 CI의 SF3 없는 checkout도 검증.
- 실제 정상 Actions: https://github.com/ju87-super/PocketScore/actions/runs/39197730979
- 의도적 실패 Actions: https://github.com/ju87-super/PocketScore/actions/runs/39197733189
- 상세 결과와 한계: [검증 보고](ci-cd-results.md), [운영·설정 안내](ci-cd.md).

## 검토 기준과 한계

Alpha PR #3이 아직 main에 병합되지 않아 이 PR의 초기 base는 `feat/pocketscore-2-alpha`입니다.
Alpha 병합 후 필요하면 main으로 retarget하세요. Alpha 앱 기능 코드는 변경하지 않습니다.
연음표·붙임줄 편집/재생, 실제 Galaxy Tab/S Pen, 인간 청음, MuseScore GUI, 실제 WASM
빌드·런타임 및 Pages 배포는 검증 완료로 보고하지 않습니다. 미지원 표기는 명시적으로 거부합니다.
Rulesets 초안은 제공하지만 실제 보호 정책과 Pages 설정은 소유자 적용이 필요합니다.
