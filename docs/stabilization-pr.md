# PR 제목

Stabilization 0.1: 편집 안정성 및 악보 렌더링 성능 개선

# PR 설명

드래그 중 창 포커스/화면 폭 변경 시 진행 중 편집이 남고, C7의 터치 영역이 잘리는 문제를 수정합니다. 단일 마디 수정·커서 이동 때마다 전체 악보를 다시 만들던 동작을 줄이며 기존 음악 데이터와 조작은 유지합니다.

- 확인·수정한 결함 6건: High 1, Medium 4, Low 1. 창 blur/문서 숨김/재배치 취소, 포인터 캡처 해제, 큰 안전 정수 분수 정확성, C7 터치 영역, SVG 전체 재생성을 다룹니다.
- 현재 컨테이너의 immutable 마디 참조만 캐시합니다. 조표·박자·폭·마디 순서/개수 변경 시 전체 무효화하고, 부분 갱신 결과를 전체 새 SVG와 비교합니다. 같은 스냅 단계의 포인터 미리보기 전송도 생략합니다.
- 조표 15개 × 박자 7종, seed 0x5c0ae의 500단계 편집, 쉼표 선택 삭제/분할·기록 복구, C2–C7, 긴 악보 커서/입력/취소 및 1,600회 연속 편집을 보강했습니다.
- 새 런타임 의존성, 제품용 테스트 API, 악보 기능 추가는 없습니다. 4–64마디 테스트 데이터는 별도 fixture 번들로만 제공합니다.

검증: npm ci, typecheck, lint(0 warning), 단위 테스트 166개(기존 55), 프로덕션 빌드, 실제 Chromium 테스트 22개(기존 12) 통과. 실패/skip 없음. `npx playwright install --with-deps chromium`은 su 관리자 인증 실패로 완료하지 못했고, 저장소가 지원하는 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium` override로 Chromium 154.0.8037.57을 사용했습니다.

동일 프로덕션 fixture/1280×900/브라우저로 각 버전 3라운드 측정한 중앙값(ms):

| 64마디 동작 | 수정 전 | 수정 후 |
| --- | ---: | ---: |
| 음높이 | 64.90 | 2.30 |
| 길이 | 60.20 | 2.20 |
| Undo/Redo | 61.60 | 2.10 |
| 커서 | 61.15 | 0.40 |
| 초기 렌더 | 78.50 | 90.60 |
| 조표 | 69.25 | 83.35 |
| 박자 | 65.15 | 70.85 |
| 폭 재배치(2 RAF 포함) | 68.40 | 83.40 |

국소 편집은 크게 개선되지만 일부 초기/전역 동작은 느려졌습니다. 최대 RAF 간격 중앙값도 100.10→133.30ms로 악화됐습니다. JS는 959,998→962,094 bytes, JS heap도 소폭 증가했습니다. 500KB 경고를 숨기지 않았습니다. 국소 편집 이득 때문에 이 최적화를 유지하며 초기/전역 재배치는 후속 과제로 둡니다.

[감사·결함별 재현/원인/수정/테스트](https://github.com/ju87-super/PocketScore/blob/fix/stabilization-performance-0.1/docs/stabilization-0.1.md)와 [4/16/32/64마디 전체 측정 및 원시 JSON](https://github.com/ju87-super/PocketScore/blob/fix/stabilization-performance-0.1/docs/performance/stabilization-results.md)을 참고하세요.

실제 Galaxy Tab/S Pen, Windows Chrome 및 MuseScore GUI는 미검증입니다. Pages 호스트는 proxy CONNECT 403으로 접근할 수 없어 배포 검증은 미실행했습니다. main 병합·직접 푸시·강제 푸시, 공개 범위·개인정보·Pages 설정 변경과 배포는 수행하지 않았습니다.
