# PocketScore

태블릿용 악보 편집기 **2.0 Alpha**. 펜으로 음표를 좌우로 끌어 길이, 상하로 끌어
음높이를 바꾸고, 여러 악기·성부·화음을 작성해 저장하고 MS Basic으로 재생합니다.

```sh
npm ci
npm run dev
```

앱 경로는 `/PocketScore/`입니다. **N 음표 입력**을 켜고 빈 오선지/쉼표를 누르거나,
음표를 선택해 **속성**에서 편집하세요. 손가락은 기본 스크롤·확대이며 직접 편집은
명시적으로 켤 수 있습니다. **파일 → 프로젝트 저장**으로 JSON을 다운로드하세요.
자동 저장은 아직 없습니다. 첫 재생은 MS Basic 음원 51.3MB를 준비합니다.

- [Alpha 기능·검증·제한 사항](docs/pocketscore2-alpha.md)
- [개발 환경과 검사 명령](docs/development.md)
- [음원 출처와 라이선스](THIRD-PARTY.md)

MuseScore Studio 4.7.5를 참고한 React/VexFlow UI이며 MuseScore C++/Qt 엔진이나
Muse Sounds를 내장하지 않습니다. 실제 Galaxy Tab/S펜과 MuseScore GUI 검증은
별도 필요합니다. 기존 편집기는 `/PocketScore/legacy/`에 보존합니다.
