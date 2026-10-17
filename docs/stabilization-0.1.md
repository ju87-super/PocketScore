# Stabilization 0.1 감사 보고서

## ① 전체 감사 결과

기준: `8341e9a` (음악 설정 PR #1이 병합된 main). 작업 브랜치는
`fix/stabilization-performance-0.1`이며 앱 시작 악보와 조작 방식은 유지했습니다.

감사 대상은 음악 엔진 5개 파일, 편집기/입력 4개 파일, SVG 렌더러와 CSS,
기존 단위·Chromium 테스트, CI/배포 설정입니다. 음악 데이터와 렌더러는 계속 독립적이며
새 런타임 의존성을 추가하지 않았습니다.

발견·수정: **6건 — Critical 0, High 1, Medium 4, Low 1**.
그중 STAB-06은 데이터 결함이 아닌 측정으로 확인한 반응성 문제입니다.
지원되는 일반 음악 편집의 음표 손실, 중복 ID, 마디/성부 경계 침범은 재현되지 않아
`score.ts`, `pitch.ts`, `settings.ts`, `accidentals.ts`, `state.ts`, `gesture.ts`를 억지로 변경하지 않았습니다.
이는 모든 가능한 결함이 없다는 보장은 아닙니다.

| 영역 | 조사 및 검증 |
| --- | --- |
| 분수/마디 | 정규화, 큰 안전 정수, 정확한 합계·시작, 7종 박자, 원자적 변경 거부 |
| 길이/쉼표 | 반복 병합·분할, 노트/마디/성부 장벽, 새 ID, 선택된 쉼표 삭제·분할과 기록 복구 |
| 음높이/임시표 | 15개 조표, 반음·온음계 이동, C2–C7 경계, 반복/취소/다른 옥타브·다성부·마디 초기화 |
| 기록 | seed `0x5c0ae`의 500단계 혼합 조작, 오류 후 상태/기록 보존, Undo/Redo |
| 포인터/키보드 | 마우스, 펜·터치 에뮬레이션, 방향 잠금, 취소/포커스/재배치, 입력 컨트롤 단축키 보호 |
| SVG/레이아웃 | 4–64마디, 폭 반복 변경, 시스템 시작 기호, 기호의 실제 잉크 경계, 터치 영역, DOM 수명 |
| 성능/배포 | 프로덕션 별도 fixture, DOM/heap/frame/long task, 번들 크기, 기존 배포 주소의 읽기 전용 접근 |

## ② 실제 수정 내역

### STAB-01 — 창 포커스 이탈 후 드래그가 남음 (High)

- 발생 조건: 음표를 드래그하다가 브라우저 창의 포커스를 잃음.
- 재현: 첫 C4 선택 → 위로 20px 드래그(E4 미리보기) → window blur.
- 기대: 원래 악보·선택·기록으로 롤백하고 편집 모드 전환을 다시 허용.
- 실제: E4 미리보기와 진행 중 트랜잭션이 남아 버튼들이 비활성화됨.
- 원인: section의 React `onBlur`만 처리하며 창 blur/문서 숨김을 처리하지 않음.
- 수정: window blur 및 visibilitychange 시 동일한 취소 경로를 사용하고 리스너를 해제.
- 회귀 테스트: `stabilization.spec.ts`의 window blur 테스트. 수정 전 실패, 수정 후 통과.

### STAB-02 — Esc 취소 뒤 포인터 캡처가 남음 (Low)

- 발생 조건: 마우스 버튼을 누른 채 드래그하다 Esc로 취소.
- 재현: 위로 20px 드래그 → Esc → mouseup 전에 `hasPointerCapture(1)` 확인.
- 기대: 취소와 동시에 캡처 해제.
- 실제: mouseup까지 캡처가 유지됨.
- 원인: cancel이 ref와 음악 상태만 초기화하고 브라우저 캡처를 해제하지 않음.
- 수정: 트랜잭션 ref를 먼저 지운 뒤 캡처 해제. 뒤따르는 lostpointercapture는 무시.
- 회귀 테스트: 6회 연속 Esc 취소·캡처 검사. 수정 전 첫 검사 실패, 수정 후 통과.

### STAB-03 — 재배치 중 이전 좌표로 드래그 계속 (Medium)

- 발생 조건: 드래그 미리보기 중 악보 폭과 줄바꿈이 변경됨.
- 재현: 첫 음표 위로 드래그 → viewport를 600px로 축소 → 손을 뗌.
- 기대: 좌표 기준이 무효가 된 편집을 롤백하고 불필요한 기록을 남기지 않음.
- 실제: 이동된 악보에서도 기존 좌표의 미리보기/편집이 계속됨.
- 원인: ResizeObserver가 SVG만 교체하고 진행 중 제스처를 유지함.
- 수정: 실제 폭이 바뀔 때 취소 후 최신 score/selection으로 재배치.
- 회귀 테스트: resize 중 드래그 취소. 수정 전 실패, 수정 후 통과.

### STAB-04 — 큰 정수 분수의 정확성 손실 (Medium)

- 발생 조건: 유효한 safe-integer 분수의 교차곱이 안전 정수 범위를 벗어남.
- 재현: `9007199254740990/9007199254740991`과
  `9007199254740989/9007199254740990` 비교; `MAX_SAFE_INTEGER/2` 두 개 덧셈.
- 기대: 앞 분수가 더 크고, 합계는 표현 가능한 `MAX_SAFE_INTEGER/1`.
- 실제: 비교 결과가 같음(0), 덧셈은 중간 곱 때문에 오류.
- 원인: Number 교차곱을 반올림한 뒤 비교하거나 약분 전에 거부함.
- 수정: 일반 음악 길이는 기존 Number 경로를 사용하고, 안전 범위를 넘는 중간 연산만
  BigInt로 수행·약분한 뒤 안전한 모델 값으로 변환. 최종 결과 자체가 표현 불가능하면 거부.
- 회귀 테스트: `stabilization.test.ts`의 큰 정수 비교·덧셈·뺄셈 및 범위 초과 거부.
  수정 전 두 테스트 실패, 수정 후 통과. 현재 16분 단위 UI에서 발생한 데이터 손실은 아닙니다.

### STAB-05 — C7의 터치 영역이 SVG 밖으로 잘림 (Medium)

- 발생 조건: 첫 시스템에서 C7 음표를 선택.
- 재현: 첫 C4에서 ↑ 21회 → 터치 rect와 SVG 경계 비교.
- 기대: 기존 44px 이상 터치 영역이 전부 보여야 함.
- 실제: 48px rect의 위쪽 7px가 잘려 보이는 높이가 **41px**.
- 원인: 음표 y에서 항상 24px를 빼고 SVG 경계를 고려하지 않음.
- 수정: 터치 영역 y만 SVG 내부로 제한. 음표/임시표 위치와 음악 데이터는 이동하지 않음.
- 회귀 테스트: 실제 앱 C7, 긴 악보 fixture의 C2/C7 경계.
  수정 전 브라우저에서 41px 확인, 수정 후 44px 이상 통과.

### STAB-06 — 선택/단일 마디 편집마다 SVG 전체 재생성 (Medium)

- 발생 조건: 악보 선택, 커서 이동, 한 음표의 음높이·길이 변경.
- 재현: 64마디 fixture에서 반복 커서 이동·편집 및 DOM 변이 관측.
- 기대: 선택은 강조만 변경하고 음악 편집은 변경된 마디의 기호·hit target만 갱신.
- 실제: 모든 VexFlow 마디·음표·target을 다시 만들며 반복 포인터 미리보기도 같은 일을 수행.
- 원인: `renderScore()` 시작마다 `replaceChildren()`을 호출하고 입력값이 같은 스냅 단계도 dispatch.
- 수정: 현재 컨테이너 하나에만 보관하는 WeakMap 캐시, immutable 마디 참조 기반 갱신,
  선택 CSS/ARIA만 변경, 스냅 단계 중복 전송 제거, ResizeObserver 수명 고정.
  조표·박자·실제 폭·시스템 배치·마디 순서가 달라지면 전체 무효화.
  unmount에서 DOM/캐시/관찰자/포인터·문서 이벤트를 정리.
- 회귀 테스트: 기존 마디/SVG 노드 유지 여부, 변경 마디의 교체 여부,
  단일 편집·Undo/Redo·전역 설정·연속 resize 뒤 전체 새 SVG와 비교.
  같은 스냅 단계의 빠른 포인터 20회가 노드를 재생성하지 않고 한 건으로 커밋됨도 검사.
  자동 생성 ID만 제외한 전체 SVG를 SHA-256으로 비교하므로 실패 시 거대한 SVG를 로그에 출력하지 않음.

## ③ 최적화 결과

수치와 한계는 [성능 측정 결과](performance/stabilization-results.md)에 기록합니다.
원시 측정은 같은 디렉터리의 baseline/optimized JSON에 보관합니다.

기준과 수정 버전을 **동일한 프로덕션 fixture, 동일 Chromium, 같은 1280×900 viewport**에서
각각 3라운드 측정합니다. 모델은 테스트 데이터로만 4/16/32/64마디를 생성합니다.
제품에 긴 악보 생성 UI나 테스트 제어 API를 넣지 않습니다.

- 각 라운드는 새 브라우저 context를 사용하며 폰트 준비를 기다립니다.
- 초기/전체 SVG는 1회 warm-up 후 4회, 각 편집 시나리오는 12회 측정합니다.
- 동기 업데이트+강제 layout 시간과 실제 RAF 간격을 구분합니다.
- resize 시간은 비동기 ResizeObserver를 포함하도록 2 RAF를 기다립니다.
- DOM 변이·SVG 노드 수, long task(50ms 초과), GC 뒤 JS heap을 함께 기록합니다.
- 메모리 반복치는 12회 workload 뒤 별도 4회 workload를 두 번 다시 마운트한 결과입니다.
  힙은 브라우저별 추정치이며 이 짧은 측정으로 장기 누수 부재를 보장하지 않습니다.
  보강 검사로 같은 64마디 마운트에서 1,600회 편집도 수행했습니다. 기록은 100개, SVG 노드는
  2,308개로 제한됐으며 heap 증가 수치와 한계는 성능 보고서에 공개합니다.
- 외부 테스트/빌드와 성능 실행을 겹치지 않습니다. 기준 소스는 `git archive`로
  `.cache` 아래에 추출하며 기존 체크아웃/작업 브랜치를 전환하거나 수정하지 않습니다.

재현 명령(저장소 루트, 설치된 Node/npm/Chromium 필요):

```sh
npm ci
npm run build
node scripts/benchmark.mjs baseline 8341e9a
node scripts/benchmark.mjs optimized
```

결과는 `.cache/performance-results/{label}.json`이며 `dist/`, `node_modules/`,
성능 사이트/추출 소스/임시 빌드는 모두 기존 ignored 경로에 보관합니다.
브라우저 경로는 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`로 지정할 수 있습니다.

## ④ 회귀 테스트와 명령 결과

| 명령/검증 | 결과 |
| --- | --- |
| `npm ci` | 성공, 고정 lockfile로 238개 설치 |
| `npm run typecheck` | 통과 |
| `npm run lint` | 통과, 0 warning |
| `npm test` | 기존 55 → **166개 통과**, 6개 파일, 실패/skip 없음 |
| `npm run build` | 통과. 500KB 번들 경고 유지 |
| `npx playwright install --with-deps chromium` | 실패: root 전환 시 `su: Authentication failure` |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:e2e` | 기존 12 → **22개 통과**, 실패/skip 없음 |
| 배포 검증 | 미실행: 기존 Pages 호스트의 proxy CONNECT가 403으로 거부됨 |

Chromium은 시스템에 설치된 **154.0.8037.57**, Playwright는 lockfile의 **1.64.1**입니다.
저장소가 지원하는 executablePath override로 실제 브라우저 검증을 완료했습니다.
브라우저 설치 명령 실패와 브라우저 테스트 통과를 구분하며, 설치 성공으로 보고하지 않습니다.

재현 테스트를 먼저 실행한 결과 STAB-01/02/03의 Chromium 3개와 STAB-04의 단위 2개는
수정 전 실패했습니다. STAB-05는 수정 전 실제 DOM 측정으로 확인했습니다.
나머지 새 검증은 기존 음악 의미를 유지하는 회귀/극한 검사이며 기존 테스트를 삭제하거나
검사 기대값을 맞춰 실패를 숨기지 않았습니다.

## ⑤ 남은 문제와 후속 작업

- 실제 갤럭시 탭/S Pen, Windows Chrome, MuseScore GUI는 **미검증**입니다.
  Chromium의 펜·터치 에뮬레이션과 Linux 테스트가 이를 대신하지 않습니다.
- 전역 조표·박자 및 폭 변경은 여전히 전체 레이아웃입니다. 64마디의 전역 변경은
  장기 작업이 남을 수 있으며 다음 단계는 측정 후 시스템 단위 갱신/가시 영역 렌더링 검토입니다.
- 반복 편집의 JS heap에 소폭 증가가 남아 있습니다. 전체 브라우저 RSS/네이티브 SVG와
  장시간 기기 측정으로 워밍업·캐시/GC 변동과 누수를 더 구분해야 합니다.
- 번들 크기 경고는 유지합니다. VexFlow의 공식 `bravura` entry는 Bravura(~324KiB 원본 JS),
  Academico/Academico Bold(각 ~32KiB)와 렌더러를 포함합니다. 기존 React/ReactDOM/VexFlow는
  모두 사용 중입니다. 내부 비공개 경로로 폰트를 제거하거나 경고 한도를 높이지 않았습니다.
- 초기 4마디 악보에서 2/4·3/8로의 축소 거부는 음표 보존 규칙에 따른 정상 동작입니다.
- 장시간 실기 입력, 대규모 다성부 UI와 손가락/펜 혼합·장치별 팜 리젝션은 후속 실기 검증 대상입니다.

## ⑥ GitHub 작업 결과

- 브랜치: `fix/stabilization-performance-0.1`
- 기준 main: `8341e9a`
- 측정 도구: `bea8e28`
- 정확성/입력 수정: `1d3d915`
- 터치 영역 수정: `4613290`
- 반응성 최적화: `a127f92`
- 독립 RAF 측정: `3b4dac3`
- 측정 원시 자료/보고서 커밋: `b966a37`
- 브랜치 푸시: 성공. 원격은 위 브랜치이며 main에는 푸시하지 않았습니다.
- PR 자동 생성: 미완료. `POST https://api.github.com/graphql`이 `Forbidden`으로 거부됐습니다.
- GitHub Actions 조회: 미완료. 해당 브랜치 runs API가 `Forbidden`으로 거부됐습니다.
  로컬 검사 통과와 GitHub Actions 상태를 구분합니다.
- [PR 생성 URL](https://github.com/ju87-super/PocketScore/pull/new/fix/stabilization-performance-0.1)
- [복사 가능한 PR 제목·설명](stabilization-pr.md)
- 최종 HEAD SHA는 작업 완료 메시지에 기록합니다.

웹에서 PR 제목과 설명을 복사해 main 대상 PR을 생성하고 변경 내용 및 Actions 결과를 검토하면 됩니다.
이 환경의 API 제한 때문에 실제 PR/CI 성공으로 주장하지 않습니다.
`main` 직접 푸시·병합, 강제 푸시, 저장소 공개 범위·이메일 개인정보 설정·Pages 배포 설정 변경과
Pages 재배포는 하지 않습니다.
