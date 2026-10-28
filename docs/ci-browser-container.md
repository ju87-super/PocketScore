# 브라우저 CI 실행 환경 안정화

2026-10-28, main `fd770e71320f561a4bea0c0a39e89bfaa0eb2392`와 AGENTS.md, 열린 PR #2를 확인하고 `ci/prebuilt-playwright`에서 작업한다. PR 생성은 사용자에게 맡긴다.

## 문제와 원인

[PR #11 병합 후 첫 main CI](https://github.com/ju87-super/PocketScore/actions/runs/40452252717/attempts/1)는 앱 테스트 전에 실패했다. `playwright install --with-deps chromium`이 Ubuntu 미러에서 글꼴·시스템 패키지 25.9MB를 내려받는 동안 5분 제한을 넘었다. 이전 main CI에서도 오디오 job의 같은 설치 단계가 실패했다. 2차 재실행은 성공했지만 설치에는 약 3분 41초가 걸렸다. 병합한 파일은 검증한 브랜치와 동일했고, 패키지 다운로드 지연 구간이 확인됐다. 미러 서버 자체와 러너 네트워크 중 어느 쪽이 느렸는지는 로그만으로 구분하지 않는다.

기존 npm 캐시는 Ubuntu 시스템 패키지를 캐시하지 않는다. 제한만 늘리거나 Chromium 파일만 캐시하면 이 다운로드 의존은 남는다.

## 변경

- `ci.yml`의 Browser E2E·SoundFont Integration, `deploy-pages.yml`의 build·smoke, `musescore-wasm.yml`의 runtime, 총 5개 job에 같은 이미지를 사용한다.
- 공식 `mcr.microsoft.com/playwright:v1.64.1-noble`을 manifest digest `sha256:47b510dd9230bf0b9bfc9b20102241e577ea7a99334ab4c3ca19f19770e9b8ea`까지 고정한다. MCR의 GET manifest에서 digest와 Linux amd64/arm64 지원을 확인했다.
- 브라우저 job에서 `apt`·`playwright install --with-deps`를 제거한다. 실제 Qt/Emscripten 빌드용 native prerequisites 설치는 별도이며 그대로 유지한다.
- `.nvmrc`의 Node와 packageManager의 npm 고정, `npm ci`·잠금 파일 검증·npm 캐시는 유지한다. 컨테이너에 포함된 임의 Node 버전을 그대로 채택하지 않는다.
- 공통 `verify-browser`는 잠금 의존성으로 설치한 Playwright 버전을 확인하고 Chromium을 실제 실행해 페이지 제목을 읽는다. 기능 테스트와 PCM 오디오 통합은 별도로 전부 실행한다.
- 시작 성공/실패·Node/Playwright/Chromium 버전·경로·시간을 JSON/log/Step Summary로 남긴다. 사전 검사에는 2분 제한을 두고 실패 시 테스트를 진행하지 않는다. 기존 실패 screenshot·trace·Artifacts와 필수 `check`, timeout, 재시도 0, 실패 보존 정책은 유지한다.
- 공식 이미지에는 GitHub CLI가 포함되지 않으므로 Pages build의 최신 main SHA 확인은 `actions/github-script@v8`의 인증된 REST 호출로 바꾼다. 조회 실패나 SHA 불일치는 계속 실패한다. 배포 직전 host job의 두 번째 SHA 확인도 유지한다.
- WASM runtime은 Python 3.12를 명시적으로 준비해 MSCZ inspector가 컨테이너의 우연한 Python 설치에 의존하지 않게 한다. Qt/Emscripten 빌드와 WASM 실험의 수동 실행 정책은 그대로다.

## 검사와 유지보수

새 계약 검사는 5개 이미지의 일치·버전/lockfile 일치·digest 고정·설치 명령 제거·사전 검사 제한/로그/항상 업로드를 확인한다. 실제 브라우저가 없는 별도 임시 경로로 사전 검사를 실행해 nonzero exit와 실패 JSON/요약을 확인한다. Pages의 실제 SHA 검사 스크립트도 검증된 SHA 허용과 오래된 SHA 거부를 각각 실행한다. 기존 실패/취소/생략/누락의 `check` 거부, Pages의 main·권한 정책 검사는 유지한다.

Playwright 업그레이드 시 package.json/lockfile과 5개 이미지의 버전·digest를 함께 갱신하고 실제 Actions를 실행한다. 근거는 [공식 CI 컨테이너 안내](https://playwright.dev/docs/ci#via-containers), [Docker 안내](https://playwright.dev/docs/docker), [브라우저 캐시의 한계](https://playwright.dev/docs/ci#caching-browsers)다.

로컬 검증 결과는 다음과 같다. 기존 테스트를 삭제하거나 생략하지 않았다.

| 검증 | 결과 | 시간 |
|---|---|---|
| 타입·ESLint·actionlint·production build·잠금 파일 | 성공 | quality 합계 15.0초 |
| CI/WASM 도구 계약 | 32/32 성공, 새 계약 4개 포함 | quality에 포함 |
| 기존 전체 단위 | 262/262 성공 | 2.39초 |
| 고정 이미지 안 Chromium E2E | 99/99 성공, 실패·생략·재시도 0 | 빌드 포함 132.1초 |
| 고정 이미지 안 실제 SF3/PCM | 4/4 성공, 실패·생략·재시도 0 | 빌드 포함 28.6초 |
| 고정 이미지 안 로컬 production artifact smoke | 1/1 성공 | 4.45초 |

컨테이너에서도 Node 24.19.0/npm 11.9.0을 사용했다. 사전 검사에서 Playwright 1.64.1과 Chromium 156.0.8078.4 실행을 확인했다(브라우저 시작 0.173초, 이미지 pull/npm 설치 시간 제외). 컨테이너의 기본 Node 24.22.1/npm 11.19.1을 그대로 쓰지 않았다. CI 계약 중 22개는 같은 컨테이너에서도 추가 실행해 누락 브라우저 실패 기록·SHA 거부·Python MSCZ inspector를 확인했다. 이 22개는 위 32개와 중복이므로 합산하지 않는다.

실제 GitHub 검증은 [브랜치의 Validate 실행 목록](https://github.com/ju87-super/PocketScore/actions/workflows/ci.yml?query=branch%3Aci%2Fprebuilt-playwright)에서 확인한다. 정확한 Actions 실행 링크와 결과는 완료 보고에서 제공한다.

## 한계와 범위

컨테이너 이미지 pull과 npm 다운로드에 대한 네트워크 의존은 남는다. 컨테이너를 받기 전에 실패하면 checkout이나 진단 스크립트가 실행되지 않으므로 Initialize containers 로그로 확인한다. 이미지가 존재한다는 사실을 Chromium 실행 성공으로 계산하지 않는다.

실제 Pages 배포와 MuseScore WASM 본체 빌드·편집·저장 검증은 이번 작업에서 실행하지 않는다. 배포용 smoke는 로컬 production artifact로 검증하며 실제 사이트 배포 성공으로 보고하지 않는다. 실제 Galaxy Tab/S Pen 테스트도 수행하지 않는다. main 병합·Pages 배포·공개 범위·보호 정책은 변경하지 않는다.
