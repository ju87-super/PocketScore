# PocketScore — Codex project instructions

## Mission
Build a mobile-first, offline-capable music notation editor for Samsung Galaxy Tab S Pen, finger touch, and keyboard, with MusicXML interchange with MuseScore.
Do not claim real tablet tests or MuseScore GUI verification unless performed.

## Architecture
- React + TypeScript + Vite. Use VexFlow for notation layout.
- Canonical score data must be independent of the SVG renderer, playback, UI, storage, and MusicXML.
- Use exact rational note/rest durations and start times, with measure and voice invariants.
- Support MusicXML 4.0 carefully; never silently discard unsupported musical content.
- Planned browser audio: FluidSynth WebAssembly + MuseScore MS Basic SF3 when licensing and distribution are verified. Muse Sounds is not a SoundFont; do not embed it.
- Keep the initial development serverless and free; plan GitHub Pages project base as /PocketScore/.

## Core UX rules
- No permanently open bottom input panel. Maximize score canvas.
- Collapsible narrow left toolbar; contextual popovers only when useful.
- Treat S Pen as a normal pointer, just like finger or mouse. Do not require handwriting recognition or proprietary pen APIs.
- Vertical drag of a note changes pitch; horizontal drag of a note/rest changes duration, snapped to valid rhythmic values, with preview.
- Shortening a note/rest creates a rest for the released duration.
- Lengthening a rest may absorb only immediately following adjacent rests in the same voice and measure, stopping at notes/barlines.
- Default Studio keyboard: Up/Down moves selected pitches by semitone; Shift+Left/Right extends a time range; Left/Right traverses rhythm events including rests and barlines. Shift+click selects the time/voice/staff range, including whole chords at the same onset. Ctrl/Cmd+click selects individual noteheads across voices/instruments. The legacy editor retains its historical diatonic/Shift-chromatic shortcuts.
- Default Studio groups preserve pitch intervals and reject ALL duration changes, including shortening and horizontal drags. Mouse and S Pen follow the same rules. Do not introduce drag-box selection or native UI text dragging; keep normal text-input selection.
- Undo/Redo records score edits atomically and preserves current mixer/master/sound settings. Sound-only changes neither enter score history nor clear redo. Ctrl/Cmd+Z, Ctrl+Y and Ctrl/Cmd+Shift+Z must work without hijacking text inputs.
- Support Undo/Redo, pointer-cancel rollback, focus-safe keyboard shortcuts, and mobile navigation vs editing distinction.

## PocketScore 2.0 rebuild priorities
- Base the overall UI and functional reference on MuseScore Studio 4.7.5, but **do not replace or remove PocketScore's direct-edit gestures or keyboard model**. The renderer (MuseScore WASM vs VexFlow) must not decide input semantics.
- **Essential S Pen behavior:** drag a selected note **right/left to lengthen/shorten duration**, **up/down to raise/lower pitch**. During dragging show a snapped preview, lock the gesture axis, and commit as a single Undo step. Cancel/lost capture must roll back.
- **Essential keyboard behavior (updated by user feedback 2026-10-24):** Studio Arrow Up/Down change single/group pitches by semitone. Shift+Left/Right extends selection; Shift+Up/Down is not the chord-selection shortcut. Arrow Left/Right navigate through notes **and rests**, across barlines. Keep Undo/Redo and do not intercept typing in controls.
- Preserve exact rhythmic accounting and do not erase other notes when extending duration. Keep pen editing distinct from finger navigation and zoom/pan.
- Both UI rewrite and engraving-engine options must pass these UX tests before being called complete. See [docs/pocketscore2-input-ux.md](docs/pocketscore2-input-ux.md) for the complete acceptance contract.
- Follow [docs/pocketscore2-playback.md](docs/pocketscore2-playback.md) for MuseScore-style playback/sound profile goals and licensing boundaries. Muse Sounds is not an included asset.
- Use milestone-sized PRs for 2.0 feature delivery and deterministic tests for all changed editing behavior. Do not treat static architecture or artifacts as a working end-to-end editor.

## Development quality gates
- Work in small scoped changes; add and run deterministic unit tests for each musical edit.
- Prioritize tests for duration invariants, rest merging/splitting, cursor traversal, semitone notation, gesture orientation, and Undo/Redo.
- Run available typecheck, lint, test, and production build before PR; report results accurately.
- Do not mask failures with snapshot updates or pretend unsupported functions work.
- Bootstrap environment and S Pen input prototype before audio/PWA/full MusicXML features.
