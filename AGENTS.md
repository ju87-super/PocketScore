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
- Keyboard Up/Down moves pitch diatonically; Shift+Up/Down moves by semitone; Left/Right moves the cursor through ALL rhythm events, including rests, across barlines. Pitch commands leave rests unchanged.
- Support Undo/Redo, pointer-cancel rollback, focus-safe keyboard shortcuts, and mobile navigation vs editing distinction.

## Development quality gates
- Work in small scoped changes; add and run deterministic unit tests for each musical edit.
- Prioritize tests for duration invariants, rest merging/splitting, cursor traversal, semitone notation, gesture orientation, and Undo/Redo.
- Run available typecheck, lint, test, and production build before PR; report results accurately.
- Do not mask failures with snapshot updates or pretend unsupported functions work.
- Bootstrap environment and S Pen input prototype before audio/PWA/full MusicXML features.
