악기 하나의 고정 예제만 편집하던 PocketScore를, 여러 악기·오선지·성부·화음을
작성하고 JSON으로 저장·다시 열어 실제 MS Basic SF3로 재생하는 **2.0 Alpha**로
확장합니다. MuseScore 4.7.5의 모듈과 UI 구조를 참고한 React/VexFlow 구현이며,
기존 펜 드래그와 키보드 편집을 새 화면에서도 유지합니다.

### 구현

- 상단 7개 메뉴, 음표 입력 도구, 접이식 팔레트·속성·믹서, 페이지/연속/배율.
- SVG와 독립적인 프로젝트 구조·분수 시간, 다중 악기·성부·음표/쉼표/화음,
  구조 추가/삭제, 마디 복사/붙여넣기, 전역 조표·박자·음자리표·마디 시작 템포.
- 명시적인 화음 구성음 선택, 원본 스냅샷 드래그, 축 잠금, 취소/Undo/Redo,
  쉼표·마디·악기 경계를 넘는 방향키, 기본 손가락 탐색과 명시적 편집 전환.
- 엄격한 프로젝트 JSON 저장/로드와 제한된 MusicXML 4.0 입출력. 지원하지 않는
  기보는 교체 전에 거부하며 기존 프로젝트를 보존.
- MIT 권리·정확한 해시를 확인한 MS Basic 51,278,610바이트와 원본 라이선스 포함.
  SpessaSynth AudioWorklet에서 피아노·기타·베이스·드럼 합성, 템포/화음/성부 해석,
  재생·정지·일시정지·시크·선택 마디·전체 반복·메트로놈·커서·저장되는 믹서.
- 실제 자산 크기/SHA-256 검사, 로딩 중 정지, 실패 후 재시도, 뒤 쉼표 길이 보존.
- 기존 안정화/렌더 캐시 수정과 PR #2의 설계 계약·정적 probe 테스트를 포함.
  기존 편집기는 `/PocketScore/legacy/`, 새 Alpha는 기본 `/PocketScore/`.

### 검증

- Node 24.19.0 / npm 11.9.0, 고정 lockfile `npm ci`.
- TypeScript / ESLint / 전체 Vitest **188/188** / production build 통과.
- 실제 Chromium 154.0.8037.57 **33/33** 통과: 새 Alpha 11개와 기존 22개 회귀.
- 합성기의 실제 PCM 비영점, 정지 후 영점, 네 악기 개별 출력,
  일시정지/재시작/전체 반복/메트로놈/로딩 중 정지/다운로드 실패 후 재시도.
- 4악기·5오선지·복수 성부·화음·드럼·템포 변경 fixture의 MusicXML 4.0 XSD 통과.
- PR #2 정적 artifact probe 단위 테스트 **4/4**. MuseScore WASM 런타임 검증과 구분.

### 제한과 다음 단계

악기별 악보를 순서대로 표시합니다. 전문 총보 시스템/페이지 분할과 겹친 성부의
직접 선택은 후속입니다. 연음표·붙임줄·이음줄·강약·아티큘레이션·기보 반복,
임의 A/B 루프, 사용자 SF2/SF3, Muse Sounds 공식 연동, 자동 저장/복구·오프라인은
미구현입니다. MusicXML은 지원 부분집합 밖의 내용을 거부합니다.

최초 음원 다운로드는 51.3MB이며 VexFlow/내장 폰트 JS 청크의 500KB 경고가 남습니다.
실제 Galaxy Tab/S펜·스피커 청음·MuseScore GUI·GitHub Actions 결과는 로컬 Chromium
검사로 대체했다고 주장하지 않습니다. main 병합·공개 범위 변경·Pages 배포는 하지 않습니다.

세부 범위·소스 분석·재현 명령: [Alpha 구현 문서](https://github.com/ju87-super/PocketScore/blob/feat/pocketscore-2-alpha/docs/pocketscore2-alpha.md).
권리/출처: [THIRD-PARTY.md](https://github.com/ju87-super/PocketScore/blob/feat/pocketscore-2-alpha/THIRD-PARTY.md).
