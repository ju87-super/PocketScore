# PocketScore — MuseScore식 화면 도구와 포인터 입력

후속: [MuseScore식 스크롤·도크 편집 화면](musescore-workspace.md)은 긴 악보에서도 도구에 접근할 수 있도록 편집 창과 스크롤을 분리한다.

2026-10-26 사용자 피드백: 복잡한 단축키 대신 MuseScore의 실제 소스를 참고해 화면 구성과 조작을 웹에 가깝게 옮긴다. 기존 그룹 선택·길이 변경 금지·반음 이동·히스토리는 유지한다.

최신 main `47e58201deb04dc2d688fca93edbebda9c363586`과 열려 있는 PR #7을 확인했다. 입력 구현 `bfa7e56`을 바탕으로 같은 `feat/musescore-note-entry` 브랜치를 보완해 새 PR과의 충돌을 피한다.

## 실제 참고한 소스와 적용

모든 링크는 MuseScore Studio **v4.7.5**의 고정 태그다. 파일을 내려받아 QML 구조와 입력 명령·상태·포인터 동작을 읽었다.

| 소스 | 확인한 동작과 적용 |
| --- | --- |
| [NoteInputBar.qml](https://github.com/musescore/MuseScore/blob/v4.7.5/src/notationscene/qml/MuseScore/NotationScene/NoteInputBar.qml) | 구역별 기호 도구, 구분선, checked 강조, 설명 tooltip, 가용 공간에 따른 도구 배치. 웹에서는 44px 타깃과 내부 가로 스크롤로 적용 |
| [noteinputbarmodel.cpp](https://github.com/musescore/MuseScore/blob/v4.7.5/src/notationscene/qml/MuseScore/NotationScene/noteinputbarmodel.cpp) | 길이·점·쉼표·임시표·1~4성부의 상태별 체크 표시. 중복된 로컬 성부 상태를 제거하고 실제 선택/입력 성부에서 체크 상태를 계산 |
| [NoteInputBarActionDelegate.qml](https://github.com/musescore/MuseScore/blob/v4.7.5/src/notationscene/qml/MuseScore/NotationScene/internal/NoteInputBarActionDelegate.qml) | 버튼과 의미 있는 입력 명령 연결. React 도구도 기존 음악 명령과 히스토리에 연결 |
| [NotationPage.qml](https://github.com/musescore/MuseScore/blob/v4.7.5/src/appshell/qml/MuseScore/AppShell/NotationPage/NotationPage.qml) | 상단 입력·재생 도구와 좌우 팔레트/악기/Inspector, 중앙 악보의 분리. 웹의 문서 탭·기호 도구·팔레트 탭·속성·악보 책상으로 적용 |
| [notationviewinputcontroller.cpp](https://github.com/musescore/MuseScore/blob/v4.7.5/src/notationscene/qml/MuseScore/NotationScene/notationviewinputcontroller.cpp) | hover의 shadow-note와 입력 시 `put-note`, Shift의 replace. 웹 미리보기·같은 박자 화음·입력 모드 Shift 대체에 적용. 기존 사용자 요구에 따라 쓰기는 release에 확정하고 취소는 복원 |
| [notationnoteinput.cpp](https://github.com/musescore/MuseScore/blob/v4.7.5/src/notation/internal/notationnoteinput.cpp) | 입력 상태, 음표 추가와 쉼표 모드, 음악 변경의 Undo 경계. 기존 독립 프로젝트 명령으로 연결 |

이는 기능과 배치를 참고해 새 React/TypeScript 코드로 구현한 웹 UI다. upstream의 QML/C++ 코드, 애플리케이션 아이콘·로고·Qt 실행 파일은 포함하지 않는다. upstream 코드는 GPL-3.0-only이며, 직접 복사·번역한 코드가 있다는 의미로 표현하지 않는다. 기보 기호는 기존 VexFlow의 Bravura를 사용한다. MuseScore C++/Qt/WASM 엔진을 실행했다고 주장하지 않는다.

## 키보드 없이 확인하는 순서

1. 상단 파일 아이콘으로 **새 악보**를 만든다.
2. **음표 입력 → 4분음표 기호**를 누르고 오선지의 원하는 높이를 누른다. 옅은 기보 미리보기가 입력 위치를 보여준다.
3. **화음** 도구를 누르고 같은 마디의 다른 높이를 누른다. 같은 시작 시점의 구성음이 추가되고 기존 길이는 유지된다.
4. 쉼표·점·임시표와 **1~4성부**를 화면 버튼으로 선택한다. 필요한 성부는 실제 음악 데이터에 생성되며 Undo된다.
5. **선택** 도구로 돌아가 음표를 누른다. **속성 → 화음 전체 선택 → 반음 올리기/내리기**로 그룹을 수정할 수 있다. 그룹 길이 버튼은 비활성화된다.
6. 선택 음 삭제, 실행 취소·다시 실행, 저장·열기·재생을 화면 버튼으로 처리한다.
7. 왼쪽 **팔레트 / 악기** 탭에서 음자리표·조표·박자·템포와 악기를 설정한다. 양쪽 도크는 접을 수 있다.

단축키는 그대로 보조 수단으로 남지만 기본 화면의 단축키 안내 띠는 제거했다. 도움말도 클릭 순서를 먼저 설명하며 키보드 안내는 접힌 항목에 둔다. 하단 고정 입력 패널은 추가하지 않았다.

## 음악 데이터와 편집 안전성

- 기호 도구와 포인터는 같은 검증된 프로젝트 명령을 사용한다. 정확한 분수 시점, 음표 길이, 성부 합계, 기존 JSON/MusicXML 형식은 유지한다.
- 포인터의 옅은 음표·쉼표·임시표·보조선은 렌더러에만 있으며 음악 데이터·재생·히스토리를 수정하지 않는다. 이동·입력 종료·취소·재배치 때 제거한다. 반복 hover의 같은 위치는 DOM을 다시 만들지 않는다.
- 선택 도구와 입력 도구를 구분한다. 앞서 합의한 Shift/Ctrl 선택, 그룹 반음 이동, 양방향 길이 변경 금지, 믹서·마스터를 유지하는 Undo/Redo는 보존한다.
- 화음 도구의 선호 상태는 악보 히스토리에 넣지 않고, 설정만 바꿔도 Redo를 지우지 않는다. 선택한 실제 성부에 입력하며 다른 성부를 덮지 않는다.
- Pointer Events의 실제 pointerId를 사용해 pen 취소와 멀티터치를 검증한다. finger 탐색이 기본이며 손가락 편집은 명시적으로 켠다. pen은 별도 키나 필기 인식 없이 동작한다.

## 검증

- 단위 테스트: 기존 223개 + 화음 도구 선호 상태/Redo 보존 1개, **224개**.
- Chromium UI: 기존 57개를 유지하고 버튼 이름·탭에 맞게 경로를 갱신했다. 음악 동작의 기존 기대를 낮추거나 테스트를 삭제하지 않았다. **포인터 전용 8개**를 더해 총 **65개**다.
- 포인터 전용 검증: 화음 생성→전체 반음 이동→삭제→Undo/Redo, 점·임시표·쉼표의 분수 시점, 성부 버튼과 실제 선택 일치, hover 데이터 보존, 팔레트·악기 설정, pen 취소, 390/800px 터치 접근·멀티터치·가로 넘침.
- 기존 실제 SF3/AudioWorklet/PCM 통합 **4개**, CI 계약 **28개**, 타입 검사·ESLint·프로덕션 빌드와 `/PocketScore/` 로컬 프로덕션 스모크도 확인한다.
- 화면 캡처: `test-results/studio-pointer-desktop.png`, `studio-pointer-390.png`, `studio-pointer-800.png`. 실제 CI 결과와 캡처는 [PR #7 검사](https://github.com/ju87-super/PocketScore/pull/7/checks) 및 Actions artifacts에서 확인한다.

## 남은 차이와 후속 작업

전문 조판·모든 팔레트·Qt 도크의 자유 배치·MuseScore 전체 기능의 복제는 완료하지 않았다. 기존의 32/64분음표, 자동 붙임줄·연음표·MIDI 입력 제한과 약 728.6 kB 공유 청크 경고가 남아 있다. 다중 성부 Ctrl/Cmd+C/V와 우클릭 도구는 앞서 합의한 후속 단계다.

실제 Galaxy Tab/S Pen, 사람의 음색 평가, MuseScore GUI/WASM 실행은 검증하지 않았다. Chromium pen/touch 에뮬레이션을 하드웨어 검증으로 보고하지 않는다. main 병합·Pages 배포·공개 범위 변경은 실행하지 않는다.
