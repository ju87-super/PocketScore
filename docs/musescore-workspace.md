# MuseScore식 스크롤·도크 편집 화면

2026-10-26 사용자 피드백: 악보 아래쪽을 편집할 때 도구를 쓰려고 위로 돌아가는 문제를 해결하고, 단축키를 제외한 편집 화면을 MuseScore에 가깝게 구성한다.

최신 main `9e08c716f864a88eaf508af5a8962ea99013973d`에서 분기했다. 기존 입력 PR #7의 병합을 확인했고, 열린 WASM PR #2는 변경하지 않았다. 새 브랜치는 `feat/musescore-workspace`다. PR 생성은 사용자가 수행한다.

## 실제 확인한 MuseScore Studio v4.7.5 소스

| 고정 태그 소스 | 확인한 구조와 이번 적용 |
| --- | --- |
| [NotationPage.qml](https://github.com/musescore/MuseScore/blob/v4.7.5/src/appshell/qml/MuseScore/AppShell/NotationPage/NotationPage.qml) | 상단 도구, 중앙 NotationView, 독립 도크, 상태 막대. 기본 도크 폭 300px을 적용하고 웹에서는 220–380px 조절과 좁은 화면 오버레이를 지원 |
| [NotationView.qml](https://github.com/musescore/MuseScore/blob/v4.7.5/src/notationscene/qml/MuseScore/NotationScene/NotationView.qml) | 악보 전용 scroll/zoom 영역. 문서 전체 대신 악보 작업 공간 하나에서 가로·세로로 이동 |
| [NoteInputBar.qml](https://github.com/musescore/MuseScore/blob/v4.7.5/src/notationscene/qml/MuseScore/NotationScene/NoteInputBar.qml) | 구역별 입력 도구와 가용 폭에 따른 배치. 기호·선택 상태·구분선을 유지하고, 터치 및 이전/다음 버튼으로 넘치는 도구에 접근 |
| [NotationStatusBar.qml](https://github.com/musescore/MuseScore/blob/v4.7.5/src/appshell/qml/MuseScore/AppShell/NotationPage/NotationStatusBar.qml) | 보기 모드와 배율을 상태 막대에 배치. 웹도 항상 접근 가능한 얇은 상태/보기 막대로 이동 |
| [PlaybackToolBar.qml](https://github.com/musescore/MuseScore/blob/v4.7.5/src/playback/qml/MuseScore/Playback/PlaybackToolBar.qml) | 독립 재생 도구 영역. 음표 도구와 함께 화면에 유지하며 작은 화면에서 가로 스크롤 |
| [DockPanel.qml](https://github.com/musescore/MuseScore/blob/v4.7.5/src/framework/dockwindow/qml/Muse/Dock/DockPanel.qml) | 도크의 패널 구분. React 도크도 제목과 스크롤 본문을 분리 |

이 소스들은 내려받아 읽었다. Qt/QML/C++ 실행, MuseScore GUI 실측, 원본 애플리케이션 자산 복사를 의미하지 않는다. upstream은 GPL-3.0-only이며 기존 보고서와 동일하게 동작·구조를 참고해 별도 React/TypeScript 구현을 작성했다.

## 바뀐 동작

- `100dvh` 편집 창 안에 상단·작업 공간·상태 막대를 배치한다. 긴 악보에서도 음표·화음·길이·임시표·성부·Undo/Redo·재생 도구가 화면 밖으로 사라지지 않는다.
- 제목과 파일 메뉴는 접기/펼치기로 공간을 확보한다. 파일 아이콘과 입력/재생 도구는 유지한다. 낮은 가로 화면에서는 제목을 생략한다.
- 팔레트와 속성에는 제목, 닫기 버튼, 독립 스크롤 본문, 데스크톱 폭 조절 경계를 둔다. 닫고 다시 열어도 탭과 패널의 스크롤 위치가 유지된다. 경계 조절의 취소·포커스 상실은 이전 폭으로 복원한다.
- 900px 이하에서는 패널을 악보 위에 열고 한쪽을 열면 다른 쪽을 닫는다. 패널은 화면 높이를 넘지 않고 제목/닫기 버튼이 남는다.
- 보기·배율·손가락 탐색/편집은 상태 막대에 둔다. 긴 안내와 오류는 정보 버튼으로 전문을 읽을 수 있다. 메뉴·알림은 작은 화면에서도 테두리 안에 들어온다.
- 믹서는 닫을 수 있는 측면 패널에서 독립 스크롤한다. 믹서를 열어도 악보 작업 공간 높이는 줄어들지 않는다.
- 화면 폭, 패널 폭, 배율, 접힌 상단이 바뀌면 화면에 보이던 마디/오선과 상대 세로 위치를 복원한다. 선택/입력 커서 이동도 악보 영역 안에서만 필요한 만큼 스크롤한다.
- 렌더러가 알려주는 최소 기보 폭으로 종이 폭을 확보한다. 작은 화면이나 확대에서 기보가 흰 종이 바깥으로 넘치지 않으며, 별도 내부 악보 스크롤과 페이지 스크롤이 중첩되지 않는다.
- 스크롤이 시작되면 pending 펜 입력과 드래그를 취소해 위치가 바뀐 뒤 음표가 확정되는 것을 막는다.

단축키, Shift/Ctrl 그룹 규칙, 그룹 길이 변경 금지, 분수 기반 음악 데이터, 조표·박자표, 재생 엔진과 파일 형식은 유지한다. 창·패널·배율 변경은 음악 히스토리나 파일 데이터에 들어가지 않는다. 하단 고정 음표 입력 패널은 추가하지 않았다.

## 검증 범위

새 Chromium 검사 `tests/e2e/workspace.spec.ts`는 다음 9개 시나리오를 추가한다.

1. 아직 확정되지 않은 펜 입력에서 스크롤하면 미리보기 제거 및 입력 취소.
2. 실제 마우스 휠로 악보만 이동, 17번째 마디에서 버튼으로 길이 선택·입력·저장·Undo/Redo, 상단 위치 및 다른 마디 보존.
3. 양쪽 도크 열기/닫기·폭 조절·취소·상단 접기·확대·실제 viewport 크기 변경에서 마디와 상대 위치 보존.
4. 패널 내부 휠 스크롤과 닫기/다시 열기 복원, 믹서의 독립적인 높이.
5. 390×844 레이아웃·각 메뉴 전체 경계·오류 안내·종이/기보 경계.
6. 800×1280에서 같은 검사.
7. 1280×800에서 같은 검사.
8. 844×390 가로 화면에서 같은 검사.
9. Chromium 실제 터치 이벤트의 손가락 스와이프가 음표를 편집하지 않고 내부 악보만 이동, 넘치는 도구에 이전/다음 버튼으로 접근.

기존 단위 224개, 브라우저 65개, 실제 SF3/AudioWorklet/PCM 통합 4개와 CI/WASM 도구 계약 28개를 유지한다. 신규 검사 포함 브라우저는 74개다. Node 24.19.0 / npm 11.9.0 / 실제 Chromium(`/usr/bin/chromium`)에서 확인한 최종 로컬 결과는 다음과 같다.

| 검사 | 결과 | 실행 시간 |
| --- | --- | --- |
| `npm run ci:quality` | 타입·ESLint·잠금 파일 일치·워크플로 검사·28 도구 계약·프로덕션 빌드 통과 | 19.72초 |
| `npm test` | 224/224 통과 | 3.83초 |
| `npm run ci:browser` | 74/74 통과, 실패·skip·flaky 0 | 빌드 포함 162.57초 |
| `npm run ci:audio` | 실제 SF3/PCM 4/4 통과, 실패·skip·flaky 0 | 빌드 포함 36.50초 |

패널을 닫을 때 DOM을 유지하게 되어 기존 화음 입력 검사의 패널 기대만 ‘DOM에 없음’에서 ‘화면에서 닫힘’으로 갱신했다. 음표·화음·시점·파일 데이터에 대한 기존 기대는 유지했다. 브라우저 재실행 전 ESLint도 다시 통과했다. GitHub Actions 실행 링크와 결과는 브랜치 완료 보고에서 제공한다.

캡처는 `test-results/workspace-390x844.png`, `workspace-800x1280.png`, `workspace-1280x800.png`, `workspace-844x390.png`에 기록된다. 실패 시 기존 Playwright 설정대로 스크린샷·trace·보고서를 저장한다.

## 직접 검토하는 순서와 한계

1. 새 브랜치의 PR을 생성하고 `/PocketScore/` 프로덕션 빌드를 연다.
2. 긴 악보 아래로 이동한 뒤 상단 도구로 계속 입력한다.
3. 팔레트/속성 열기·접기·폭 조절, 상단 접기, 배율 변경과 태블릿 회전을 확인한다.
4. 실제 Galaxy Tab에서 손가락 탐색, S Pen 입력, 브라우저 주소창 변화와 터치 키보드를 확인한다.

이번 변경은 스크롤과 편집 창 구성에 집중한다. MuseScore 전체 기능이나 픽셀 단위 동일성, 모든 도크의 자유 이동/별도 창, 모든 기보 도구·전문 조판·자동 붙임줄·연음표·다중 성부 클립보드·우클릭 도구까지 완료했다는 뜻이 아니다. 단축키는 기존 사용자 합의를 유지한다. 실제 Galaxy Tab/S Pen, MuseScore GUI/WASM 실행과 사람의 음색 평가는 수행하지 않았다. 기존 약 728.6kB 공유 청크 경고는 남아 있다.

main 병합·Pages 배포·공개 범위 및 저장소 설정 변경은 실행하지 않는다.
