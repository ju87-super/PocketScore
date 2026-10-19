# PocketScore 2.0 — MuseScore Studio 4 playback requirements

**Status:** product requirements and source-based design, not an implemented audio engine.
**Upstream reference:** [MuseScore Studio v4.7.5](https://github.com/musescore/MuseScore/tree/v4.7.5)

## Non-negotiable goal

PocketScore playback must follow **MuseScore Studio 4's model**: score-derived performance events, per-instrument sound assignment, selectable sound profiles, transport and timeline, and a mixer. Keep audio timing and score editing synchronized. Do **not** claim identical Muse Sounds quality without authorized Muse Sounds support.

## Official architecture references

- `src/playback/internal/playbackcontroller.cpp`: transport actions (play/pause/stop/selection start), loop, metronome, repeat controls and sound profile orchestration.
- `src/engraving/playback/`: performance interpretation; inspect ties, tuplets, tempo changes, dynamics and articulations.
- `src/framework/audio/`: engine, mixing, audio resources and synth routing.
- `src/framework/musesampler/`: MuseSampler integration code; this **does not convey rights to distribute or run the proprietary library/samples**.
- `src/web/audioengine/webaudioengine.cpp` and `src/web/appjs/distr/muapi.js`: experimental web audio and JavaScript entrypoint.
- `SetupConfigure.cmake`: `APP-WEB` explicitly disables `MUE_BUILD_MUSESOUNDS_MODULE` (and many other components), so parity is unproven.

Official documentation: https://handbook.musescore.org/sound-and-playback/musesounds ,
https://handbook.musescore.org/sound-and-playback/mixer ,
https://handbook.musescore.org/sound-and-playback/soundfonts
MuseSounds product FAQ: https://sounds.musescore.org/

## Playback engine design

1. **Interpretation**: derive accurately timed events from the canonical score. Preserve score display notation independent of playback parameters. Handle rests, measures, tied durations, chords, multiple voices, tracks, tempo map, time signatures and octave/transposing instrument semantics. Interpret repeated sections and articulation/dynamic metadata when supported.
2. **Timeline and transport**: `play`, `pause`, `stop`, `seek`, `playFromSelection`, `loopIn`, `loopOut`, optional count-in and metronome. Scheduler should avoid notes stuck after stop and playback drift. Selection/cursor should follow playback position.
3. **Sound profiles and routing**: `Basic` is default, source should be MS Basic SF3 where license and exact redistributable artifact are confirmed. A `MuseSounds` profile is **capability-gated** and must not appear as active without actual authorized engine/samples. If a requested sound is unavailable, present an explicit fallback to Basic.
4. **Mixer**: instrument-level strips, preset selection, gain/volume, pan, mute, solo, master; optionally basic reverb and effects. Keep instrument sound assignment distinct from displayed clef/notation. Persist mixer settings and reload them with the score.
5. **Web architecture**: prefer an authorized MuseScore audio engine build if it can actually run and perform acceptably in the browser. Otherwise implement a modular WebAudio/WebAssembly SoundFont synthesizer, with a clear adapter for later source-compatible engine reuse. Do not let audio engine source dependencies contaminate notation model or UI.
6. **Performance**: initialize audio only after a user gesture if required by browser policies, prevent conflicting concurrent playbacks, expose loading/error states, test mid-range Galaxy Tab devices in landscape and portrait, and measure device memory, startup and scheduling jitter.

## Muse Sounds / licensing reality

- **Muse Sounds Core** is free *for supported use with MuseScore Studio* and Muse Sounds Pro adds additional libraries, but the MuseSounds FAQ says the libraries are designed for Studio and are not available as ordinary VST/AU/AAX plugins.
- MuseSampler/Muse Sounds binary libraries and sample content are not automatically licensed for third-party app distribution because MuseScore code is GPLv3.
- **Never** embed, scrape, extract, repackage, copy installation libraries, circumvent restrictions, or claim official Muse Sounds support without a verified authorization and compatible integration path.
- Outputs recorded/rendered inside MuseScore Studio can be used according to their applicable license, but that does not grant permission to embed Muse Sounds themselves in PocketScore.
- MS Basic is the practical first target; audit the precise SoundFont asset's licensing, attribution and origin before bundling. No binaries or sound libraries added in this change.

## Vertical milestone: playable Alpha

Build one end-to-end playable score featuring **piano, electric guitar, bass and drums** (verify sound patches), with:
- [ ] Play, pause, stop and seek from a selected measure
- [ ] Audibly distinct per-instrument sounds through a legal SoundFont engine
- [ ] Tempo and time-signature interpretation, non-drifting playback cursor
- [ ] Chords, rests, tied notes and multiple voices have correct timing
- [ ] Mixer with volume, pan, mute and solo; settings survive save/reopen
- [ ] Offline test if all required permitted assets are locally available
- [ ] Explicit performance measurements on Chromium and actual tablet before mobile performance claims

### Expanded test matrix

Use small deterministic scores with expected onset/duration/routing events; unit tests should not rely on subjective listening alone.
- 4/4, 6/8, a mid-score meter change, tempo map (120→160 BPM)
- Rest at bar start, tied notes across barlines, simultaneous voices/chords
- Stop/pause while notes sound, seek while playing, metronome downbeats
- Volume/pan/mute/solo per track, fallback missing preset, persistence
- Repeat/loop positions and articulation/dynamics where implemented

**Delivery:** code + tests + browser verification + screenshots/logs + exact inventory of functioning versus unavailable sounds. Do not mark Muse Sounds integrated based on seeing a setting in UI alone.
