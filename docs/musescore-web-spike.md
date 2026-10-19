# PocketScore 2.0 — MuseScore Studio 4 WebAssembly feasibility

**Status (2026-10-19): source audit complete. No MuseScore WASM build or real tablet/browser test has been run.**

Pinned upstream: [MuseScore Studio v4.7.5](https://github.com/musescore/MuseScore/tree/v4.7.5). The existing PocketScore prototype in `main` must remain unchanged until a replacement is demonstrated.

## Objective

Reuse MuseScore Studio 4's layout, note editing and music representation for a Galaxy Tab score editor with S Pen, touch and keyboard, eventually offline with MusicXML interchange. Prefer the Studio 4 notation toolbar, palettes, instruments, inspector, score viewport and playback layout, adapted to smaller touch screens.

## Source audit (pinned upstream)

| Source | Verified observation | Consequence |
| --- | --- | --- |
| [CMakeLists.txt](https://github.com/musescore/MuseScore/blob/v4.7.5/CMakeLists.txt) | `app-web` build configuration exists and is labeled experimental/internal-use. | There is a web build entry point, not a supported independent engraving SDK. |
| [SetupConfigure.cmake](https://github.com/musescore/MuseScore/blob/v4.7.5/SetupConfigure.cmake) | `APP-WEB` disables `MUE_BUILD_IMPEXP_MUSICXML_MODULE`, MIDI import, MuseSounds and many other modules. WASM threads are disabled here. | Web feature parity and MusicXML interchange are **not** established. |
| [src/app/webapi_export.cpp](https://github.com/musescore/MuseScore/blob/v4.7.5/src/app/webapi_export.cpp) and [exported_functions.cmake](https://github.com/musescore/MuseScore/blob/v4.7.5/src/app/exported_functions.cmake) | Exports `load`, `startAudioProcessing`, `addSoundFont`, `malloc`, `free`. | No generic note-insertion/editing command API is exposed to React. |
| [muapi.js](https://github.com/musescore/MuseScore/blob/v4.7.5/src/web/appjs/distr/muapi.js) | JS methods: `loadScoreFile`, `loadScoreData`, `startAudioProcessing`; project-saved callback. | Integration surface is narrow. |
| [webapi.cpp](https://github.com/musescore/MuseScore/blob/v4.7.5/src/web/appjs/webapi.cpp) | Load writes input bytes to `/mu/temp/current.mscz` and dispatches `file-open`. | Existing web load route is MSCZ-oriented, not verified as MusicXML import. |
| [viewer.html](https://github.com/musescore/MuseScore/blob/v4.7.5/src/web/appjs/viewer/viewer.html) | Web example mounts a Qt screen and loads `MuseScoreStudio.js`. | The current web app renders Qt UI, not reusable React components. |
| [engraving](https://github.com/musescore/MuseScore/tree/v4.7.5/src/engraving), [notation](https://github.com/musescore/MuseScore/tree/v4.7.5/src/notation), [notationscene](https://github.com/musescore/MuseScore/tree/v4.7.5/src/notationscene) | C++ score/editing/layout components exist. | Reuse candidates exist, but standalone WASM separation is **unproven**. |

**Interpretation:** the upstream web configuration is principally an experimental Qt/MuseScore application. Compiling the whole app and exposing an independent, fine-grained, headless score editing engine are **different technical tasks**.

## Competing approaches

1. **A — Full upstream Qt WebAssembly app** inside a PocketScore wrapper. Validate browser start, score edit/save and tablet interaction first. Fastest initial route but likely constraints on UI and footprint.
2. **B — Dedicated WASM music engine with a React UI.** Create a narrow C++ bridge (load score, return layout, select/insert note, undo, serialize) and preserve score invariants. More suitable to a bespoke tablet UI but substantial build/engineering risk.
3. **Fallback — Separate model and renderer** using current React/VexFlow, gradually porting only algorithms proven safe and license-compatible.

Do not select B merely because the source tree contains `engraving`. Require a **running** read/edit/layout command round trip first.

## Static build artifact gate (added here)

After using a **correct Qt-for-WebAssembly + Emscripten toolchain** to build the upstream `app-web` configuration, point this command at its output folder:

```sh
node --test tools/musescore-web/probe.test.mjs
node tools/musescore-web/probe.mjs /absolute/path/to/app-web/output --json
```

The artifact probe checks for `MuseScoreStudio.js`, `MuseScoreStudio.wasm`, `viewer.html`, `distr/muapi.js`, `distr/muimpl.js`, `distr/qtloader.js`, `distr/config.js`, WebAssembly v1 magic bytes, and the three public API method names. **It does not compile, load or execute the WASM**, or prove its exported runtime functions work. Fixture-based tests exercise only the probe's success/failure behavior. Do not report the fixture as a successful MuseScore build.

The upstream generated `viewer.html` must be served through HTTP(S), not `file://`, for manual browser testing. Record the exact upstream commit/tag, Qt/Emscripten versions and actual build logs when attempting this. An upstream-supported build recipe for this machine has not been proven.

### Required acceptance checks

- [ ] Compile upstream `app-web` into complete output artifacts and pass the static gate.
- [ ] Load `viewer.html` in desktop Chromium; capture console errors, download size, startup time and peak memory.
- [ ] Open a **user-created** MSCZ, add/edit a note, save, reopen and compare note data.
- [ ] Repeat with a long score (e.g. 64 bars), measuring latency and UI responsiveness.
- [ ] Run on a **real Galaxy Tab** with S Pen and fingers; test selection, tapping, scrolling, zoom, palm interference and keyboard mode.
- [ ] Prototype a React-to-C++ command interface with a working note edit and undo; verify score invariants.
- [ ] Investigate enabling MusicXML import/export in web build and verify round trips including voices/tuplets.
- [ ] Decide between A, B and fallback based on evidence, not visual similarity.

### Stop/go decision

- **Go A** only if Qt WASM works acceptably on tablet and MuseScore-like UI control is sufficient.
- **Go B** only if a custom command bridge works on actual WASM and model/engraving correctness is maintained.
- **Fallback** if the WASM build or separation is impractical; do not delete current PocketScore.
- **No production rewrite** until a candidate passes runtime and data-safety gates.

## Environment / licensing

This audit environment had Node 22.16.0 and CMake 3.31.6, but neither `emcc` nor Qt `qmake`; an upstream C++/WASM compile was **not performed**. Local Node tests are not a substitute for this build.

Upstream [LICENSE.txt](https://github.com/musescore/MuseScore/blob/v4.7.5/LICENSE.txt) is GPL-3.0-only. If distributing a combined derivative of GPL-covered MuseScore code, assess copyleft, attribution and source distribution duties. Check trademarks, UI assets, fonts and soundfonts separately; neither MuseSounds nor MS Basic SF3 should be assumed redistributable without license verification. No upstream C++ source or binary or musical assets are copied into this spike.
