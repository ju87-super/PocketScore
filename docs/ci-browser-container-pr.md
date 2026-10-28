# PR 제목

ci: run browser checks in a pinned Playwright container

# PR 본문

main 병합 후 CI가 Ubuntu 시스템 패키지 다운로드에서 5분 제한을 넘겨 브라우저 테스트를 시작하지 못했다. Chromium과 OS 의존성이 포함된 공식 Playwright 이미지를 버전·digest로 고정해 일반 브라우저/오디오, Pages 사전/배포 후 smoke, WASM runtime의 반복 설치를 제거한다.

Node/npm 고정과 npm ci, 필수 검사 이름, 테스트·실패 아티팩트를 유지한다. 공통 사전 검사가 실제 Chromium 실행과 페이지 로딩을 확인하고 버전·시간·오류를 남긴다. Pages의 오래된 SHA 배포 거부는 컨테이너에서도 작동하도록 인증된 REST 호출로 유지하고, WASM inspector의 Python도 명시적으로 준비한다.

타입·린트·actionlint·빌드·262 단위·32 CI/WASM 도구 계약을 통과했다. 고정 이미지 안에서 Chromium 99개·실제 SF3/PCM 4개·로컬 production artifact smoke 1개가 성공했고, 브라우저 생략·실패·재시도는 0개다. 컨테이너에서도 프로젝트의 Node 24.19.0/npm 11.9.0을 사용했다.

검증 결과와 제한 사항은 [상세 보고서](ci-browser-container.md)를 참조한다. 실제 Pages 배포와 MuseScore WASM 엔진 빌드/실행은 이번 검증 범위에 포함하지 않는다. 이미지 pull과 npm 다운로드의 네트워크 의존은 남는다.
