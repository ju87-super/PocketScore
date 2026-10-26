# PR 제목

feat: MuseScore식 기호 도구와 포인터 중심 악보 편집 구현

# PR 본문

음표·화음 입력을 위해 복잡한 단축키를 외워야 했던 흐름을 화면 도구 중심으로 바꿉니다. MuseScore Studio 4.7.5의 실제 NoteInputBar QML, 입력 상태 모델, NotationPage와 포인터/shadow-note 코드를 확인해 기호 도구 묶음, 체크 상태, 좌우 도크와 입력 미리보기를 웹에 적용합니다.

기본 흐름은 **음표 입력 → 길이 기호 → 오선지 클릭 → 화음 도구 → 다른 높이 클릭**입니다. 쉼표·점·임시표·1~4성부·선택·전체 화음 선택·반음 이동·삭제·Undo/Redo·파일·재생을 화면에서 처리합니다. 키보드는 보조로 유지하고 도움말에서 접어 둡니다. 팔레트/악기 탭과 속성은 접을 수 있으며 하단 고정 입력 패널은 추가하지 않습니다.

음악 모델과 SVG를 분리하고 분수 시점·마디 합계·JSON/MusicXML을 보존합니다. hover는 음악 데이터와 히스토리를 바꾸지 않습니다. 실제 선택 성부를 도구에 반영하고 pointerId에 맞게 취소합니다. 기존 Shift/Ctrl 선택, 그룹 길이 변경 금지, 반음 이동, 음원 설정을 유지하는 Undo/Redo 및 legacy 입력도 유지합니다. 명시적 입력의 범위 대체·악보 끝의 마디 추가는 원자적으로 검증·기록합니다.

검증 범위: 단위 224개, Chromium UI 65개(화면 도구만 사용하는 신규 8개 포함), SoundFont 통합 4개, CI 계약 28개, 타입 검사·린트·프로덕션 빌드·로컬 프로덕션 스모크. 기존 테스트는 삭제·생략하지 않습니다. 390/800px 화면과 pen/touch는 Chromium 에뮬레이션이며 실제 Galaxy Tab/S Pen·MuseScore GUI·사람의 음색 평가는 수행하지 않습니다. 실제 결과·캡처는 Validate artifact를 확인합니다.

전체 MuseScore C++/Qt/WASM 엔진이나 모든 기능을 복제한 것은 아닙니다. QML/C++와 로고·앱 아이콘을 포함하지 않고 웹 코드를 새로 작성했으며 기보 기호는 기존 Bravura를 사용합니다. 32/64분·자동 붙임줄·연음표·MIDI 등 기존 제한과 번들 크기 경고가 남아 있습니다. 다중 성부 복사·붙여넣기와 우클릭 도구는 후속 단계입니다. main 병합이나 Pages 배포를 실행하지 않습니다.

[참고한 실제 소스·화면 조작·검증·제한](https://github.com/ju87-super/PocketScore/blob/feat/musescore-note-entry/docs/musescore-pointer-ui.md)
