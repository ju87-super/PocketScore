# MuseSampler API compatibility research — PocketScore 2.0

**Date:** 2026-10-26 (Asia/Seoul)
**Status:** source/API feasibility study and repeatable STATIC check. **No Muse Sounds playback, no proprietary library execution, no browser runtime, no tablet demonstration, no permission grant.**
**Pinned upstream:** MuseScore Studio 4.7.5, commit [3654226c2e99289916916953a98e585a3d3b315a](https://github.com/musescore/MuseScore/tree/3654226c2e99289916916953a98e585a3d3b315a).
**Scope:** an isolated research PR; the production SpessaSynth/MS Basic SF3 backend stays unchanged.

## Executive conclusion

MuseSampler is not a standard browser AudioWorklet, SF3 SoundFont, or VST. The pinned MuseScore native source **dynamically loads** a separately installed proprietary sampler shared library, negotiates version-specific function pointers, sends interpreted score performance events, and requests rendered audio buffers. That makes a native adapter technically conceivable, but does **not** make Muse Sounds licensed for PocketScore, usable by browsers, or compatible with Android devices.

The publicly readable MuseSampler API *interface* (in the MuseScore GPL-3.0-only source tree) is distinct from the closed-source MuseSampler runtime and Muse Sounds sample libraries. There is no verified, authorized public browser SDK/API for PocketScore in the reviewed official materials. Official MuseHub documentation dated May 2026 says MuseSounds cannot be loaded in other programs. A 2023 developer discussion acknowledged technically loading MuseSampler elsewhere; this older statement is neither a current permission grant nor a tested PocketScore runtime.

**Recommendation:** Preserve the existing legal MS Basic/SpessaSynth playback; investigate the **public API contract only** and contact the rights holder before attempting native proprietary integration or claiming compatibility. A synthetic, independently implemented engine can exercise a transport concept, but is **not Muse Sounds**.

## Evidence (source and trust level)

| Evidence | What is established | What is NOT established |
| --- | --- | --- |
| [v4.7.5 libhandler.h](https://github.com/musescore/MuseScore/blob/3654226c2e99289916916953a98e585a3d3b315a/src/framework/musesampler/internal/libhandler.h) | Dynamic library function lookup, API version branches and event/renderer entry points, GPL source | License to load or distribute MuseSampler/MuseSounds |
| [v4.7.5 apitypes.h](https://github.com/musescore/MuseScore/blob/3654226c2e99289916916953a98e585a3d3b315a/src/framework/musesampler/internal/apitypes.h) | Public C ABI types, note/dynamic/pedal/articulation structures | Browser-ready WebAssembly implementation |
| [v4.7.5 musesamplerresolver.cpp](https://github.com/musescore/MuseScore/blob/3654226c2e99289916916953a98e585a3d3b315a/src/framework/musesampler/internal/musesamplerresolver.cpp) | Native library path, loadApi, initialization and failure handling | Use from Android Chrome or independent frontend |
| [v4.7.5 musesamplerwrapper.cpp](https://github.com/musescore/MuseScore/blob/3654226c2e99289916916953a98e585a3d3b315a/src/framework/musesampler/internal/musesamplerwrapper.cpp) | Score playback setup and float sample processing | Same audio quality without licensed sounds |
| [v4.7.5 SetupConfigure.cmake](https://github.com/musescore/MuseScore/blob/3654226c2e99289916916953a98e585a3d3b315a/SetupConfigure.cmake) | APP-WEB explicitly turns MUSE_MODULE_MUSESAMPLER and MUE_BUILD_MUSESOUNDS_MODULE OFF | Fixing the unrelated WASM configure error would turn these modules on |
| [MuseScore discussion #17801](https://github.com/orgs/musescore/discussions/17801) | Contributor said a separate native program could theoretically load the sampler in 2023; external Pure Data author later reported v0.5 worked but v0.6 initialization failed | Current reproducible external integration or formal support |
| [Muse-sampleganger article (2022)](https://zen1th.me/posts/the-musesampleganger/) | Someone implemented a *different* synthesizer accepting parts of MuseSampler's interface and played test sounds | Running proprietary Muse Sounds in PocketScore |
| [MuseHub support: What are MuseSounds? (May 2026)](https://support.musehub.com/en/articles/15070615-what-are-musesounds) | Muse Sounds designed for MuseScore Studio, not usable in other programs | General third-party usage license |
| [MuseHub partner information](https://developer.musehub.com/muse-partners-help/adding-products/product-types/musesounds) and [StaffPad announcement](https://www.staffpad.net/autumn-2023-update) | Proprietary technology is integrated in MuseScore/StaffPad; an official integration route is conceivable through the rights holder | Public redistribution rights or a Web/Android SDK |
| [Official MuseSounds FAQ](https://sounds.musescore.org/) | Audio outputs made within supported tools may be used under applicable terms | Right to embed the sound library itself |

### Pinned native API signals

- Library version entry points: ms_get_version_major, ms_get_version_minor, ms_get_version_revision.
- The pinned libhandler checks major version and branches at **0.102, 0.103, 0.104, 0.105**. For 0.105+ it selects ms_init_2; old builds may use ms_init. This explains why a demonstration against one sampler version is not a compatibility guarantee.
- Instrument resolution: ms_get_instrument_list and instrument metadata.
- Performance events: ms_MuseSampler_add_track_note_event_6 (current pinned path), dynamics, pedal, text articulation, pitch bend and vibrato.
- Transport / rendering: ms_MuseSampler_set_position, ms_MuseSampler_process, ms_MuseSampler_process_offline and all-notes-off.
- Actual entry point requirements, event layouts and supported versions MUST be rechecked against the exact pinned source; translating these names into a JS interface does not cause the proprietary runtime to work in a browser.

### Browser and Android gap

1. The current PocketScore product runs as React/VexFlow + SpessaSynth AudioWorklet in a browser, not as a Windows/macOS/Linux native app.
2. MuseSampler's desktop integration is a **native shared library**, not a JS module or precompiled browser WASM binary. Native dynamic-loading examples do not demonstrate WebAssembly support.
3. Pinned MuseScore APP-WEB disables MuseSampler and MuseSounds, in addition to having independent Qt/CMake integration issues. The separate WASM bootstrap failing configure on a missing declare_module command must not be reported as proof that a Muse Sounds build is near completion.
4. No published result reviewed here demonstrates an authorized Muse Sounds engine producing PCM from PocketScore in Android Chrome on Galaxy Tab. Any streaming/audio-service alternative additionally requires written permission, service architecture, security and real latency testing.
5. A synthesized mock API, sinusoidal tone, SF2/SF3 fallback or old desktop experiment is not a MuseSounds success criterion.

## What the reproducible public-source check does

The isolated script tools/musesampler-research/inspect.mjs:

- Accepts a **local checkout of the public MuseScore source**, requiring exact HEAD commit 3654226c2e99289916916953a98e585a3d3b315a.
- Reads only libhandler.h and SetupConfigure.cmake; finds function names used in publicly visible dynamic-symbol lookup, version guards, and whether APP-WEB disabled the two relevant modules.
- Prints JSON containing source SHA-256 checksums and a clear STATIC_PUBLIC_SOURCE_ONLY label. It fails closed when pinned API requirements or source layout change.
- Never opens libraries, downloads samples, contacts Muse services, starts audio, changes project settings, or claims runtime/legal availability.

To test the independent synthetic fixtures (also included in the Code Quality suite):

~~~sh
node --test tools/musesampler-research/inspect.test.mjs
~~~

To audit an **existing, legally obtained local checkout of the public source at exactly the pinned commit**:

~~~sh
node tools/musesampler-research/inspect.mjs /path/to/MuseScore
~~~

It does not automatically fetch dependencies. The JSON output is **not** a dynamic ABI compatibility test, MuseSampler runtime test, or audio verification.

## Proposed experimental gates

| Gate | Required evidence | Status |
| --- | --- | --- |
| R0 Public interface inspection | Pinned GPL source symbols/version branch and repeatable source-only test | **Implemented in this branch**; remote CI not presumed passed |
| R1 Rights and provider response | Written third-party permission specifying PocketScore, browser/Android, free/commercial use, packaging, user-installed data, streaming/offline, and trademark terms | **Not obtained** |
| R2 Isolated independent contract simulator | Original test double / mock synthesizer, deterministic note/dynamics/pedal/seek/stop behavior with test PCM and no Muse sample assets | **Not implemented** |
| R3 Authorized runtime integration | Provider-approved SDK or sample-free proof runtime; explicit compatible OS/ABI and license provenance | **Not implemented** |
| R4 Real web/tablet validation | Galaxy Tab Chrome, S Pen coexistence, browser memory, startup/download, note-to-audio timing, suspend/resume, no stuck notes | **Not implemented** |
| R5 Production adoption | Validated legal distribution/hosting terms, fallback to MS Basic, version checking, user-facing accurate capability state, rollback path | **Not implemented** |

### Proposed PocketScore boundary (not implemented)

PocketScore Score model → performance event mapper (notes, parts, tempo, articulations, dynamics, pedal) → pluggable PlaybackBackend.

- Default production backend remains the existing licensed SpessaSynth + MS Basic.
- Separate research-only capability reports may describe supported/unsupported events, not claim an integrated Muse Sounds profile.
- A compatible engine must implement initialization, event feed, transport, seek/loop, stop/all-notes-off, sample output, instrument catalog, error/fallback and async loading without touching notation invariants.
- Native-only prototypes should remain outside public Pages and not ship proprietary binaries/samples. Until R1 and R3, no Muse Sounds button or false assertion of readiness.

## Questions for Muse / MuseHub partnership team

1. Is a **third-party notation editor named PocketScore** eligible to license Muse Sounds playback or MuseSampler SDK integration?
2. Is there a supported **WebAssembly, JavaScript/WebAudio or Android ARM** integration API, and how are its versions and updates distributed?
3. Can playback use libraries installed and authorized by each user without repackaging, and how are authentication, offline operation, and mobile devices handled?
4. Are there permitted cloud-rendered / streamed playback architectures? What are latency, retention, caching, copyright and licensing constraints?
5. What specific obligations apply to an open-source/GPL-dependent client and a public GitHub Pages web app, including trademarks, attribution and code redistribution?
6. If such rights are unavailable, is the supported alternative **MusicXML export to MuseScore Studio → user-initiated audio/WAV render**?

A response must be documented before changing the MuseSounds capability from unavailable in src/playback/backend.ts. This document is technical research, not legal advice.

## Decision

**Proceed with R0 static public API research and, if useful, an independently authored sample-free performance-event adapter proof. Do not attempt to embed, extract, or redistribute Muse Sounds/MuseSampler, or work around product/application authorization checks.** Current product strategy remains high-quality licensed SoundFont playback while an authorized provider response is pending.
