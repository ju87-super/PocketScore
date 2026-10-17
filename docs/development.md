# 개발 환경

PocketScore Prototype 0.1: 4/4박자 악보 4마디를 표시하고 기존 음표와 쉼표를
편집합니다. README.md와 AGENTS.md는 보존합니다.

## 도구 및 설치

- Node.js 24 LTS (`.nvmrc`: 24.19.0), npm 11 (검증 버전: 11.9.0)
- React, TypeScript, Vite, Vitest + jsdom + Testing Library, ESLint
- VexFlow 5의 Bravura 번들로 SVG를 그립니다. 기호/텍스트 폰트는 번들에 포함되어
  별도 CDN 요청 없이 로딩 후 배치됩니다. 현재 빌드에는 번들 크기 경고가 있습니다.
- 비밀키, 데이터베이스, 별도 백엔드는 필요하지 않습니다.

저장소 루트에서 실행합니다. nvm을 사용하는 경우 먼저 `nvm install` 및 `nvm use`로
`.nvmrc` 버전을 선택하세요. 패키지 버전은 package-lock.json에 고정됩니다.
TypeScript는 typescript-eslint의 지원 범위에 맞춘 6.0 계열을 사용합니다.

```sh
npm ci
npm run dev -- --host 0.0.0.0
```

개발 서버의 기본 포트는 5173이며 앱 경로는 `/PocketScore/`입니다.
`.npmrc`는 npm 캐시를 무시되는 `.cache/npm`에 저장하고 Node/npm 엔진 요구를 검사합니다.

## 검증

```sh
npm run typecheck
npm run lint
npm test
npm run build
```

Vitest는 분수 연산, 음표·쉼표 편집 불변식, 커서 순회, 음높이 표기,
드래그 방향 결정, Undo/Redo/취소 및 React 키보드·포커스 처리를 검증합니다.
React 단위 테스트에서는 VexFlow 배치 어댑터를 대체하며 실제 SVG·폰트·입력은
아래 Chromium 테스트에서 검증합니다.
`npm run test:watch`로 변경 사항을 감시할 수 있습니다.
빌드는 타입 검사 후 `dist/`를 생성하며 `npm run preview -- --host 0.0.0.0`으로
확인할 수 있습니다. 미리보기 기본 포트는 4173입니다.

프로덕션 빌드 후 Playwright 브라우저 검증:

```sh
npx playwright install chromium
npm run test:e2e
```

시스템 Chromium을 사용하는 이 클라우드 환경에서는 다운로드 없이 실행할 수 있습니다.

```sh
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:e2e
```

테스트가 자체적으로 4173 포트의 미리보기 서버를 시작·종료합니다. 같은 포트의
서버가 이미 실행 중이면 먼저 종료하세요. Chromium의 마우스 입력, 펜·터치 에뮬레이션,
스크롤 모드, 드래그 취소, 좁은 화면 및 실제 SVG 렌더링을 검사합니다.
실제 장치 검증을 대신하지 않습니다.

`.github/workflows/ci.yml`은 main 푸시와 PR에서 Node.js 24로 위 네 가지 필수 검사와
Chromium 테스트를 실행합니다. 별도 Pages 배포 설정과 Windows 테스트 안내는
[deployment.md](deployment.md)에 있습니다.

## 편집 규칙

- 왼쪽 도구 막대는 접이식입니다. 하단 고정 입력 패널은 없습니다.
- 편집 모드에서 이벤트를 선택한 뒤 세로로 드래그하면 온음계 음높이가 바뀝니다.
  가로 드래그는 32 CSS 픽셀마다 유효 길이 한 단계로 이동합니다. 8픽셀 미만의
  흔들림과 대각선 입력은 무시하며, 결정된 방향은 손을 뗄 때까지 고정됩니다.
- 길이는 온음표 단위의 정확한 분수입니다. 16분/8분/점8분/4분/점4분/2분/점2분/온음표를
  지원하고, 모든 이벤트의 시작 시점·각 성부의 4/4 합계를 편집마다 검증합니다.
- 음표·쉼표 단축 시 생긴 시간을 새 쉼표로 채웁니다. 바로 뒤 연속 쉼표와 합쳐
  가능한 큰 쉼표들로 분해합니다. 편집 중인 쉼표는 선택 길이를 유지하도록 별도로
  남깁니다. 예: 4분쉼표를 8분으로 줄이면 선택한 8분쉼표와 새 8분쉼표가 됩니다.
- 연장은 같은 성부·마디의 바로 뒤 연속 쉼표만 사용합니다. 음표나 마디선을 넘을 수
  없으며, 부족한 길이는 오류 안내와 함께 거부합니다. 다른 이벤트의 시작 시점은 보존합니다.
- ↑↓는 C장조의 다음/이전 자연음, Shift+↑↓는 반음 이동입니다. 반음 상승은 샤프,
  하강은 플랫을 사용하며 B–C/E–F와 옥타브 경계를 처리합니다. 음역은 C2–C7입니다.
  쉼표에서 음높이 명령은 아무 것도 바꾸지 않습니다.
- ←→는 음표·쉼표를 모두 순회하고 마디선을 넘습니다. 처음/끝에서는 멈춥니다.
- 악보에 포커스가 있을 때만 단축키를 처리합니다. Ctrl/Cmd+Z로 취소,
  Ctrl/Cmd+Shift+Z 또는 Ctrl+Y로 다시 실행합니다. 드래그 전체는 기록 한 건이며
  pointercancel, 포인터 캡처 상실, 포커스 이탈, Esc는 원래 상태로 복원합니다.
- 탐색 모드에서는 터치 스크롤·확대를 브라우저에 맡기고 편집을 중지합니다.
- 편집 내용은 메모리에만 유지되며 새로 고침하면 초기 악보로 돌아갑니다.

## 구조

- `src/music/`: 렌더러·UI와 독립적인 분수, 음높이, 음표/쉼표/성부/마디 모델 및 편집 함수
- `src/editor/`: 편집 트랜잭션, 기록, 포인터 방향·스냅, 키보드 및 취소 처리
- `src/notation/`: 모델을 VexFlow SVG와 44픽셀 이상 입력 영역으로 변환하는 어댑터
- `src/App.tsx`: 도구 막대, 선택·미리보기 상태, 박자 검증 안내

## GitHub Pages

Vite의 `base`는 `/PocketScore/`입니다. 배포할 산출물은 `npm run build`로 생성된
`dist/`이며 JS/CSS URL에도 이 경로가 적용됩니다. 수동 Pages 워크플로는
`.github/workflows/deploy-pages.yml`입니다. 저장소 소유자의 Pages 활성화, 지원 요금제,
사이트 공개 범위 확인이 필요합니다. 설정과 실행 절차는 [deployment.md](deployment.md)를 참고하세요.

실제 Galaxy Tab의 S Pen·손가락 동작과 MuseScore GUI 호환성은 **미검증**입니다.
음표 삽입·삭제, 다성부 UI, 재생·음원 엔진, 저장, MusicXML, 오프라인/PWA는
이번 범위에 포함하지 않습니다.
