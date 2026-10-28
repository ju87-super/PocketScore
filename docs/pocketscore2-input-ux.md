# PocketScore 2.0 — Studio input and selection contract

Status: **user override 2026-10-26: graphical controls first, keyboard optional**. Studio now follows MuseScore Studio 4.7.5 step-time input. This supersedes the earlier requirement for horizontal duration dragging in Studio. The legacy editor keeps its original gestures and keyboard profile. UI/sound reference: MuseScore; web interaction reference: Songsterr.

## Graphical input (primary)

- Follow the grouped notation toolbar, checked state and docked workspace of MuseScore Studio 4.7.5. Use our existing Bravura symbols and accessible 44px web controls.
- Select the note-input tool, choose a duration symbol, and click/tap the staff. Show a translucent shadow note at the exact snapped onset and pitch without changing score data.
- Select the chord tool after entering/selecting a note and tap other heights in that bar to stack tones. No modifier key is required. The rest, dot, accidental, four voice and history buttons are directly available.
- Return to the selection tool to edit. Properties provide whole-chord selection, semitone up/down and deletion. Preserve the earlier range/list rules and the group duration ban.
- Left dock tabs expose real palettes/settings and instruments; right properties remain collapsible. Keep no permanent bottom input panel. Compact top file/playback tools and horizontal toolbar scrolling preserve space on small screens.
- Keep keyboard lists inside optional help, not the default screen. Do not show interactive controls for unsupported musical features.

## Keyboard input (optional)

| Input | Behavior |
| --- | --- |
| N | Toggle note input at the selected event, or the active staff's first position |
| 1 / 2 / 3 / 4 / 5 / 6 / 7 | 64th / 32nd / 16th / eighth / quarter / half / whole duration, matching MuseScore's numbering |
| . | Toggle a supported single dot (eighth, quarter, half) |
| A–G | Enter the named pitch at the next input position, choosing the nearest written octave |
| Shift+A–G | Add a pitch above the last entered or singly selected chord; retain duration and next input position |
| 0 | Enter a rest and advance by the chosen duration |
| Ctrl/Cmd+Alt+1–4 | Switch/create an input voice at the current time |
| Escape | Exit input; cancel pending pointer input or pitch drag |
| Delete / Backspace | Remove selected pitches, using an equal-length rest if none remain |

- Input has a visible caret. Durations, accidental choice, reference pitch and cursor are transient editor state, outside canonical project JSON and SVG layout.
- Mouse/pen taps in input mode use the chosen voice's nearest existing onset and the clicked staff height. Tapping another height at an existing pitched onset adds it to the chord, without opening properties. Shift+click in input mode replaces the clicked time span, following MuseScore's mouse-input controller; outside input mode it selects a range.
- The accidental buttons choose the next input alteration. Subsequent notes follow the shared step/octave accidental state in the measure and reset at the barline. Chords do not advance time.
- Step-time input replaces exactly its chosen time span in one voice. Other voices/staves and content outside that span are preserved. This differs from resizing an existing event, which may consume only following rests.
- At the end of the score, the next input atomically adds a measure to every staff along with the note. One Undo removes both.
- 32nd/64th notes and rests, and single dots from 32nd through half notes, are supported. Basic ties connect existing adjacent equal pitches in the same voice, across barlines/systems too. Use the screen tie/untie tools. A tied logical tone transposes together, even when both endpoints are selected; copy retains only connections whose selected endpoints are both present. See [rhythm/tie report](score-rhythm-ties.md).
- Automatic melodic input and clipboard overwrite split at barlines and into supported duration fragments, tying every chord pitch internally and preserving partial outgoing copied links. Append missing bars to all staves; advance the entry cursor by the full requested duration. Newly entered automatic segments accept chord pitches together until the chain is edited or entry restarts. Preserve sounded intervals outside the overwrite span, including existing incoming/outgoing ties. See [automatic input](automatic-tie-input.md).
- Double-whole notes, dotted 64th/whole notes, cross-voice/staff/percussion ties and tuplets remain unsupported. Reject them explicitly; never silently retime or approximate the score. Clear ties before resizing a linked event or changing meter with barline ties. Supported pitch range remains C2–C7 and chords contain at most eight distinct pitches.
- MIDI entry, repitch/rhythm-only modes and the complete MuseScore shortcut set are future work. This implements the basic step-time workflow, not all MuseScore functions.

## Selection and existing-note editing

- Up/Down transposes selected pitched components by semitone, single or group. Rests and unpitched percussion are unchanged.
- Left/Right traverses rhythm events, including rests/barlines; Shift+Left/Right extends/contracts a fixed-anchor range. Range selection exits input mode.
- Outside input mode, Shift+click selects the inclusive time × voice/staff range, including whole chords at the same onset and intervening instrument staves. Ctrl/Cmd+click toggles individual pitched components only, across voices/instruments; it exits input mode.
- No Shift+Up/Down chord-selection shortcut. Whole-measure selection includes every voice in that staff's measure.
- Groups preserve pitch intervals and reject both shortening and lengthening through numeric keys, controls and gestures. Reject a complete batch on collisions/range errors.
- A single note can still be dragged vertically using staff/key steps. An axis is locked after the movement threshold; horizontal movement does not resize Studio events. The legacy editor retains horizontal duration drag.
- Preview from the original snapshot; one completed pitch drag is one Undo. Cancel, capture loss, Escape, blur, hidden document or reflow restores the complete score/selection state.
- No native UI text drag or selection rectangle. Purple noteheads and measure backgrounds show selected content. Keep ordinary text editing in inputs.

## History, focus and touch

- Ctrl/Cmd+Z, Ctrl+Y and Ctrl/Cmd+Shift+Z cover score edits, including structures, title, written tempo, key/meter and entry. Restore input positions through history while preserving the currently chosen mode/duration.
- Mixer presets/volume/pan/mute/solo and master volume remain current through score Undo/Redo. Sound-only changes do not clear Redo.
- Ignore notation shortcuts in text inputs, selects, editable content, dialogs and IME composition. Preserve browser/control keyboard handling.
- Use normal Pointer Events for mouse, pen and touch. Pending input commits on release only; movement/cancellation leaves the score untouched. A second finger cancels an in-progress finger edit. Finger navigation is the default; enable finger editing explicitly.
- Maintain the collapsible left palette and score space. No permanent bottom input panel.
- Browser pen/touch emulation does not prove physical Galaxy Tab/S Pen behavior. Log hardware and human listening checks separately.

## Required verification

- Deterministic tests: exact cursor advancement, named pitches/octaves, chord stacking, accidental state/reset, overwrite boundaries, rest lengths, voice isolation, automatic barline/fragment edits, rejected malformed/percussion ties, atomic measure addition, Undo/Redo, duration dots and deletion.
- Chromium: eight pointer-only workflows cover chord entry, exact dotted/rest/accidental timing, voice state, readonly shadow notes, palettes/instruments, real pen pointer-ID cancellation and 390/800px touch. Also keep the actual N→5→C→Shift+E→Shift+G workflow from a blank score; mouse/pen chord entry without a properties panel; cancellation, keyboard focus, voice switching, history, portrait reflow and save/reopen.
- Preserve existing selection, playback, MusicXML and legacy gesture coverage. Update only Studio expectations explicitly superseded by the user's new input instruction; do not delete tests or treat unsupported features as passing.
- Canonical data remains independent of SVG/audio/UI; all musical time stays exact rational arithmetic.

Reference shortcuts: [MuseScore v4.7.5 shortcuts.xml](https://github.com/musescore/MuseScore/blob/v4.7.5/src/app/configs/data/shortcuts.xml). The MuseScore Qt/C++ engine itself is not running here.
