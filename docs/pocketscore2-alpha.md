# PocketScore 2.0 Alpha — 구현 및 검증

## 실행 가능한 범위

기본 `/PocketScore/`는 새 Alpha입니다. `/PocketScore/legacy/`에는 기존 단일
오선지 편집기를 보존했고, 기존 회귀 테스트는 이 경로에서 실행합니다. Alpha의
입력·파일·음원 통합은 별도 Chromium 테스트가 실제 새 화면에서 검사합니다.

상단 파일/편집/보기/추가/형식/도구/도움말, 음표 도구 모음, 접이식 왼쪽 팔레트와
오른쪽 속성, 필요할 때 여는 믹서를 구현했습니다. 하단 고정 입력 패널은 없습니다.
페이지/연속 보기와 75–150% 배율을 지원합니다. 2026-10-24 선택·이력 개선에서는
시스템마다 모든 악기의 오선을 같은 마디 위치에 정렬하는 기본 총보를 구현했습니다.
인쇄용 페이지 분할과 전문 조판 전체는 별도 범위입니다. 상세 변경은
[선택·이력 구현 보고](score-selection-history.md)를 확인하세요.

프로젝트 모델은 악기→오선지→마디→성부→음표/쉼표/화음으로 구성합니다.
최대 15악기, 악기당 4오선지, 오선지당 4성부, 128마디, 총 16,000이벤트를
검증합니다. 드럼은 GM Standard Kit 한 악기, 킥/스네어/닫힌 하이햇을 지원합니다.
음높이는 C2–C7, 리듬은 기존 온음표~16분음표 및 단일 점음표입니다.
음자리표는 높은/낮은/타악기, 조표는 ±7, 전역 박자는 7개 기존 설정을 지원합니다.

악기·오선지·성부·마디 추가/삭제, 입력 모드의 빈 오선지·쉼표 터치 입력,
음표/쉼표 전환, 화음 구성음 추가/선택/삭제, 마디의 모든 성부 복사·붙여넣기,
Undo/Redo를 구현했습니다. 새 악보와 불러오기도 실행 취소할 수 있습니다.
길이를 늘려 다른 음표나 마디선을 덮는 작업과, 음표가 잘리는 박자 변경은 거부합니다.

화음의 `pitch`와 추가 `chord` 음들이 실제 절대 음높이를 나타냅니다. 선택의
`pitchIndex`는 음표 머리 클릭 또는 속성에서 지정합니다. 단일 선택의 세로 드래그·
↑↓·임시표는 그 음 하나를 바꾸고, Shift/Ctrl 그룹 선택은 선택된 구성음만 함께 이동합니다.
임시표는 화음·동시 성부까지 포함해 마디 안의 음이름/옥타브별 상태를 계산합니다.

## 직접 편집 계약

- 펜/마우스는 기존 Pointer Events 경로를 사용합니다. 8px 임계값, 축 비율 1.2,
  기본 음높이 10px/길이 32px, 축 잠금과 원본 스냅샷 미리보기를 유지했습니다.
  배율과 75/100/150% 드래그 간격을 반영합니다.
- 한 드래그는 한 Undo입니다. pointercancel, lost capture, Esc, 포커스/창 이탈,
  숨겨진 문서와 너비 재배치 시 취소합니다. 모델과 SVG 캐시는 분리되어 있습니다.
- ←→는 같은 성부의 쉼표·마디를 거쳐 다음 성부·오선지·악기로 이동합니다.
  ↑↓는 단일·그룹 모두 반음, Shift+←→는 범위 확장입니다. Shift+클릭은
  시간·성부·오선 범위를, Ctrl/Cmd+클릭은 개별 구성음만 선택합니다.
  입력/선택 컨트롤의 방향키는 가로채지 않습니다.
- 그룹의 모든 길이 변경을 차단합니다. Undo/Redo는 악보 편집만 되돌리며
  현재 믹서·마스터 설정을 유지합니다. 길이·음높이 드래그는 한 번의 Undo입니다.
- 손가락은 기본 탐색·브라우저 확대입니다. ‘손가락 편집’을 켜면 직접 편집합니다.
  S펜 에뮬레이션은 독점 Samsung API나 필기 인식을 사용하지 않습니다.
- 겹치는 성부는 SVG 클릭만으로 모두 구분하기 어렵습니다. 방향키로 순회하고
  입력 성부와 화음 구성음을 명시적으로 선택하세요. 실제 펜/손바닥 구분은 미검증입니다.

## 파일과 데이터 보존

`src/project/`는 SVG·오디오·파일 포맷에 의존하지 않습니다. 시작과 길이는 정확한
기약분수이며 각 성부가 마디를 빈틈없이 채워야 합니다. 새 쉼표는 프로젝트 전체에서
고유 ID를 받습니다. JSON은 모든 악보·화음·템포·믹서 설정을 보존합니다.
버전/스키마/알 수 없는 필드/분수/구조/음역/중복 ID를 검증한 후 교체합니다.
파일은 최대 5MB입니다. 자동 저장은 없으므로 파일 → 프로젝트 저장을 사용하세요.

MusicXML 4.0 partwise의 제한된 부분집합을 입출력합니다: 악기·오선지·성부,
음표·쉼표·화음, 조표/박자/음자리표, 마디 시작 템포, GM 프로그램·볼륨·팬.
음악 구조를 재로드해 비교하는 테스트와 공식 MusicXML 4.0 XSD 검사를 수행했습니다.
뮤트·솔로·마스터는 XML 대신 JSON에 보존한다고 내보내기 때 안내합니다.

추가 XSD 검사 재현 명령(공식 스키마 파일과 Python lxml이 있는 경우):

```sh
node scripts/export-alpha-fixture.mjs .cache/alpha-ensemble.musicxml
python tools/validate-musicxml.py .cache/alpha-ensemble.musicxml .cache/musicxml-schema
```

검사 fixture는 4악기·5오선지·복수 성부·화음·드럼·템포 변경을 포함합니다.

지원하지 않는 요소·속성·계층, 박자 불일치, 겹친 성부, 음표 모양/실제 길이 충돌,
외부 엔티티/DOCTYPE는 거부합니다. 연음표·붙임줄·이음줄·강약·아티큘레이션·기보
반복을 조용히 삭제하지 않습니다. `.mxl`/`.mscz`, 악보 중간 조표·박자·음자리표
변경, 범용 MuseScore 파일 호환성을 지원한다고 주장하지 않습니다.

## 실제 재생

`src/playback/timeline.ts`는 분수 시점→템포 맵→초/정수 MIDI tick을 계산합니다.
쉼표, 여러 악기·성부·화음, 전역 박자, 마디 시작 템포 변경을 해석합니다.
같은 악기의 겹친 유니즌은 한 MIDI 키의 note-off가 다른 성부를 끊지 않도록 합칩니다.
이는 개별 성부의 중첩 유니즌 어택을 완전히 재현하는 전문 연주 해석은 아닙니다.

정확한 MS Basic SF3 자산을 **SpessaSynth AudioWorklet**에서 합성합니다.
피아노 GM1, 클린 기타 GM28, 핑거 베이스 GM34, GM Standard 드럼을 기본 배정합니다.
MuseScore와 같은 음원 파일을 쓰지만 FluidSynth/MuseSampler 엔진과 동일한 소리를
보장하지 않습니다. 최초 재생 51.3MB 다운로드·디코딩, 크기/SHA-256 검증 후 재생합니다.
출처와 권리는 [THIRD-PARTY.md](../THIRD-PARTY.md)에 기록했습니다.

재생/일시정지/정지/처음/선택 마디/시크/악보 전체 반복/메트로놈을 구현했습니다.
재생 커서는 합성기의 시간으로 마디 안 진행률을 표시합니다. 커서의 가로 위치는
마디 내 선형 진행률이며 VexFlow의 모든 개별 음표 간격에 정확히 맞추는 기능은 후속입니다.
시퀀서는 오디오 스레드에서 진행합니다. 미래 note-on을 메인 스레드에서 예약한 뒤
stopAll만 호출하는 방식은 쓰지 않습니다. 정지 시 순회 중단·강제 note-off·마스터
게이트를 함께 적용합니다. 초기 로딩 중 정지도 지연 자동 재생을 막습니다.

SpessaSynth는 End-of-Track 뒤 쉼표를 재생 길이에 포함하지 않으므로 악보 끝의
실제 all-notes-off 메시지로 전체 길이를 보존합니다. 완전한 쉼표 악보와 전체 마디
반복에도 적용하며 합성기 길이와 모델 길이가 다르면 오류로 중단합니다.

믹서는 GM 음색·볼륨·팬·뮤트·솔로·마스터를 JSON에 저장합니다. 설정/음표 편집은
현재 재생을 정지하며 다시 재생하면 반영합니다. 실시간 믹서 자동화는 아직 없습니다.
메트로놈은 GM 드럼 채널을 공유하므로 드럼 채널 볼륨/팬의 영향을 받습니다.
Basic만 활성화되어 있습니다. `PlaybackBackend`와 사운드 capability 목록을 통해
후속 엔진을 교체할 수 있으나 사용자 SF2/SF3와 Muse Sounds는 현재 사용할 수 없습니다.

## MuseScore 4.7.5 분석과 재사용

기준 태그의 실제 커밋은 `3654226c2e99289916916953a98e585a3d3b315a`입니다.
PR #2의 [웹 검증](musescore-web-spike.md), [입력 계약](pocketscore2-input-ux.md),
[재생 요구](pocketscore2-playback.md)를 먼저 확인하고 다음 실제 소스를 검토했습니다.

| 소스 | 확인한 구조와 Alpha 적용 |
| --- | --- |
| `src/appshell/qml/MuseScore/AppShell/NotationPage/NotationPage.qml` | DockPage, 도구 모음·팔레트·악기·Inspector·재생 패널 분리 |
| `src/notationscene/internal/notationactioncontroller.cpp`, `src/notation/internal/notationinteraction.cpp` | UI 명령과 notation interaction, Undo와 분수 길이 분리 |
| `src/engraving/dom/score.h`, `src/engraving/types/fraction.h` | 렌더링과 분리된 Score, 분수 기반 시점 |
| `src/importexport/musicxml/internal/musicxmlreader.cpp`, `musicxmlwriter.cpp` | 별도 교환 모듈, xml/musicxml과 압축 mxl 경로 구분 |
| `src/playback/internal/soundprofilesrepository.cpp`, `src/playback/qml/MuseScore/Playback/MixerPanel.qml` | Basic/Muse 프로필 자원과 악기별 믹서 |
| `src/framework/audio/engine/internal/sequenceplayer.cpp` | 오디오 clock, seek에서 트랙 flush, 상태 전환 |
| `src/framework/musesampler/internal/libhandler.h` | 외부 라이브러리 동적 로드·버전 검사, 음원 권리가 자동으로 따라오지 않음 |
| `src/web/audioengine/webaudioengine.cpp`, `src/app/exported_functions.cmake`, `SetupConfigure.cmake` | 실험 Qt 웹 앱·좁은 JS API, APP-WEB MusicXML/MuseSounds 비활성화 |

Qt WASM/Emscripten 툴체인이 준비되지 않았고 기존 웹 경로에서 독립 편집 API의
런타임 검증도 없습니다. MuseScore WASM 빌드/브라우저 통합을 성공했다고 보고하지
않습니다. 허용된 React/TypeScript/VexFlow 대체 경로를 구현했습니다. GPL 코드를
복사하거나 번역하지 않았으며 직접 재배포하는 upstream 자산은 MIT MS Basic입니다.

## 검증과 남은 단계

2026-10-19 검증: Node 24.19.0 / npm 11.9.0에서 `npm ci`, typecheck, lint,
Vitest **188/188**, production build, Chromium **154.0.8037.57**의 Playwright
**33/33**이 통과했습니다(새 Alpha 11개 + 기존 22개). PR #2의 정적 probe 테스트
**4/4**, 4악기·5오선지 fixture의 MusicXML 4.0 XSD 검증도 통과했습니다.
빌드는 VexFlow+내장 폰트를 포함한 약 **738KB** JS 청크 경고가 남습니다.
음원/합성기는 지연 로드하며 음원 51.3MB는 이 JS 경고와 별도입니다.

Chromium 검증은 실제 SVG/폰트, 새 Alpha의 펜·손가락 에뮬레이션과 방향키,
화음·다중 성부, JSON 재로드, XML 거부, 출력 PCM 비영점/정지 후 영점,
악기별 실제 음원 출력, 반복/메트로놈, 로딩 중 정지를 포함합니다. 사람이 실제
스피커를 듣거나 Galaxy Tab/S펜을 만져 검증한 것이 아닙니다.

실제 Chromium 캡처: [데스크톱](images/alpha-desktop.png), [세로 화면](images/alpha-portrait.png).

다음 Milestone B: 붙임줄·연음표·표현 기호의 모델/편집/렌더/재생을 함께 구현,
엄격한 MusicXML 지원 확장, 총보 시스템·동시 성부 선택 개선, 허가된 음원 공급자와
사용자 SoundFont 저장. Milestone C: 실제 갤럭시탭 검증·팜 리젝션·긴 악보 프로파일링,
오프라인 캐시·자동 저장·복구. 기보 반복과 임의 A/B 구간 루프는 아직 없습니다.
