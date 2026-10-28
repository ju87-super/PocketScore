# PocketScore — Codex project instructions

## Mission
Build a mobile-first, offline-capable music notation editor for Samsung Galaxy Tab S Pen, finger touch, and keyboard, with MusicXML interchange with MuseScore.
Do not claim real tablet tests or MuseScore GUI verification unless performed.

## Architecture
- React + TypeScript + Vite. Use VexFlow for notation layout.
- Canonical score data must be independent of the SVG renderer, playback, UI, storage, and MusicXML.
- Use exact rational note/rest durations and start times, with measure and voice invariants.
- Studio engraving derives meter-aware beams and measured per-bar/system spacing from immutable rhythm events (`src/notation/engraving.ts`). Keep derived beam/layout state out of score files/history; preserve cross-staff onset alignment, signature placement and hit targets through responsive reflow. Run notation unit tests in the Music Engine CI suite.
- Support MusicXML 4.0 carefully; never silently discard unsupported musical content.
- Planned browser audio: FluidSynth WebAssembly + MuseScore MS Basic SF3 when licensing and distribution are verified. Muse Sounds is not a SoundFont; do not embed it.
- Keep the initial development serverless and free; plan GitHub Pages project base as /PocketScore/.

## Core UX rules
- No permanently open bottom input panel. Maximize score canvas.
- Collapsible narrow left toolbar; contextual popovers only when useful.
- Studio workspace (user override 2026-10-26): MuseScore-style bounded editing window. Keep input/playback controls visible while the central score scrolls; dock contents scroll independently with pinned headings, close/reopen and desktop width resizing. Preserve the visible musical location through docking, zoom and responsive reflow. A compact status/view bar is allowed; no permanent bottom note-entry panel. Preserve the agreed keyboard mappings.
- Treat S Pen as a normal pointer, just like finger or mouse. Do not require handwriting recognition or proprietary pen APIs.
- Studio is graphical first (user override 2026-10-26): grouped notation-symbol buttons, selection/note/chord tools, rest/dot/accidental tools, four voice buttons, a shadow-note preview, palettes/instruments tabs and contextual properties. Basic entry/edit/history must work without keyboard shortcuts. Keep shortcuts optional in help. Studio also supports MuseScore step-time entry (2026-10-25): N mode, 3–7 duration keys, A–G notes, Shift+A–G chord tones, 0 rest, dot, Escape. Mouse/pen can stack chosen pitches at one onset. Horizontal dragging does not resize Studio events; vertical pitch drag remains. The legacy editor retains both drag axes.
- Shortening a note/rest creates a rest for the released duration.
- Lengthening a rest may absorb only immediately following adjacent rests in the same voice and measure, stopping at notes/barlines.
- Default Studio keyboard: Up/Down moves selected pitches by semitone; Shift+Left/Right extends a time range; Left/Right traverses rhythm events including rests and barlines. Shift+click selects the time/voice/staff range, including whole chords at the same onset. Ctrl/Cmd+click selects individual noteheads across voices/instruments. The legacy editor retains its historical diatonic/Shift-chromatic shortcuts.
- Default Studio groups preserve pitch intervals and reject ALL duration changes, including shortening and horizontal drags. Mouse and S Pen follow the same rules. Do not introduce drag-box selection or native UI text dragging; keep normal text-input selection.
- Undo/Redo records score edits atomically and preserves current mixer/master/sound settings. Sound-only changes neither enter score history nor clear redo. Ctrl/Cmd+Z, Ctrl+Y and Ctrl/Cmd+Shift+Z must work without hijacking text inputs.
- Studio clipboard (2026-10-27): copy selected noteheads/rests with exact relative timing; Shift ranges include intervening voice rows, Ctrl lists include only explicit pitches/rows. Map copied rows in visual order onto existing rows from the destination downward; skip/report excess rows, never add voices. Overwrite the copied time span, fill its holes with rests, append missing bars across all staves, and commit as one Undo. Reject unsupported tied fragments/barline-crossing notes atomically. Clipboard is transient, separate from score files/history/mixers; copy preserves Redo. Ctrl/Cmd+C/V, toolbar buttons and context menu share commands; text fields retain native clipboard behavior.
- Right-clicking a selected element keeps its group; clicking outside the group selects that target. The same contextual tools must be available via a screen button for pen/touch. Keep menus inside the viewport, dismiss on real scrolling/outside click/Escape/resize, preserve focus, and enforce the same group/rest editing restrictions.
- Support Undo/Redo, pointer-cancel rollback, focus-safe keyboard shortcuts, and mobile navigation vs editing distinction.

## PocketScore 2.0 rebuild priorities
- Base UI, function, sound and now note entry on MuseScore Studio 4.7.5. The user replaced the earlier custom Studio input requirement on 2026-10-25. Preserve the agreed range/list/group rules and the legacy editor. The renderer must not decide input semantics.
- **Studio S Pen behavior (2026-10-25):** tap in N mode to enter a note or chord pitch; release commits, cancellation/movement does not insert. Outside N mode vertical pitch dragging previews from a fixed snapshot and commits as one Undo. Horizontal movement leaves duration unchanged; use numeric keys or controls for duration. Preserve touch navigation and rollback.
- **Essential keyboard behavior (updated by user feedback 2026-10-24):** Studio Arrow Up/Down change single/group pitches by semitone. Shift+Left/Right extends selection; Shift+Up/Down is not the chord-selection shortcut. Arrow Left/Right navigate through notes **and rests**, across barlines. Keep Undo/Redo and do not intercept typing in controls.
- Preserve exact rhythmic accounting. Resizing an existing event cannot consume sounded notes. Explicit step-time note entry replaces its target time span in one voice, preserving all content outside it. Reject unsupported tied fragments or barline crossings explicitly. Keep pen editing distinct from finger navigation and zoom/pan.
- Both UI rewrite and engraving-engine options must pass these UX tests before being called complete. See [docs/pocketscore2-input-ux.md](docs/pocketscore2-input-ux.md) for the complete acceptance contract.
- Follow [docs/pocketscore2-playback.md](docs/pocketscore2-playback.md) for MuseScore-style playback/sound profile goals and licensing boundaries. Muse Sounds is not an included asset.
- Use milestone-sized PRs for 2.0 feature delivery and deterministic tests for all changed editing behavior. Do not treat static architecture or artifacts as a working end-to-end editor.

## Development quality gates
- GitHub browser jobs use the same official Playwright Noble image pinned by version and manifest digest. Match all image tags to the exact locked `@playwright/test` version; run `verify-browser` before tests. Do not reintroduce per-run `apt`/`playwright install` into browser jobs. Keep the pinned Node/npm setup, failure artifacts and required check names. Containers do not include GitHub CLI or a guaranteed Python runtime: preserve the Pages freshness guard and WASM inspector prerequisites when changing environments.
- Work in small scoped changes; add and run deterministic unit tests for each musical edit.
- Prioritize tests for duration invariants, rest merging/splitting, cursor traversal, semitone notation, gesture orientation, and Undo/Redo.
- Run available typecheck, lint, test, and production build before PR; report results accurately.
- Do not mask failures with snapshot updates or pretend unsupported functions work.
- Bootstrap environment and S Pen input prototype before audio/PWA/full MusicXML features.
