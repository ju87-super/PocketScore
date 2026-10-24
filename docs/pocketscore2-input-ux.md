# PocketScore 2.0 — mandatory S Pen and keyboard editing contract

Status: **updated by user feedback 2026-10-24**. Preserve direct pitch/duration gestures for single events. Studio now uses chromatic keyboard pitch and semantic range/list selection; the legacy editor retains its old keyboard profile. MuseScore Studio is the UI/function/sound reference and Songsterr the web-interaction reference.

## Input modalities and behavior

### S Pen / precise pointer: direct editing

- Tap an empty staff location in **note input mode** to place a note at the snapped pitch and rhythmic cursor position; note input may also use MuseScore-style selection/duration controls.
- Tap/select an existing note, then **drag horizontally** to alter its notated duration: right = longer, left = shorter. Update the notation preview while dragging; commit as **one undoable change on pointer release**.
- **Drag vertically** on an existing pitched note to alter its **pitch**: up = higher, down = lower. Default steps are **diatonic** and respect staff/key context.
- For a newly placed note, allow continuing into a gesture only when pointer disambiguation is reliable; do not create an extra note when a drag was intended.
- Rest horizontal drag changes rest duration, with correct time conservation. Vertical gestures on rests **do not** transpose them.
- Never change pitch and duration simultaneously on a single ambiguous diagonal drag. Determine one axis after an initial movement threshold and **lock it** for that gesture.
- Preserve current prototype gesture semantics for the first implementation: 8 CSS px movement threshold, clear-axis ratio >1.2, upward pitch increments about every 10 CSS px, duration steps about every 32 CSS px. Make thresholds configurable / calibratable for touch sizes, zoom and stylus sensitivity instead of baking these values permanently into layout.
- Use a **fixed snapshot of the pre-gesture score** for previews, not repeated edits that accumulate pitch or duration changes each pointermove.
- Prevent accidental edits from palm touches and nonprimary pointers; support pressure-agnostic Pointer Events. Do not assume Samsung proprietary APIs. Never promise physical S Pen palm rejection without testing on hardware.
- Invalid musical edits must be rejected explicitly with a message and restored to the last valid or pre-drag state. On pointercancel, capture loss, Escape or focus loss, restore the **complete pre-gesture state**.
- Dragging a pitch/duration must not corrupt part/staff/voice IDs, rhythmic values, adjacent events or ties. Time remains exact (fractions / ticks), not dependent on pixel rounding.

### Keyboard: retain and extend prototype behavior

| Key | Behavior |
| --- | --- |
| Up | Raise selected pitch(es) by one semitone |
| Down | Lower selected pitch(es) by one semitone |
| Shift + Left / Right | Extend/contract selection from its fixed time anchor |
| Shift + click | Select inclusive time and voice/staff range; at the same onset include entire chords, even in different voices/instruments |
| Ctrl/Cmd + click | Toggle individual pitched noteheads only, across voices/staves/instruments |
| Left / Right | Move edit cursor to previous / next **rhythm event**, including rests and across barlines |
| Ctrl/Cmd + Z | Undo |
| Ctrl/Cmd + Shift + Z or Ctrl + Y | Redo |
| Escape | Cancel in-progress gesture / edit |

- Do not transpose rests on Up/Down; navigation remains available.
- Prevent keyboard shortcuts from hijacking focus in text inputs, menu controls and other widgets.
- Preserve selected event identity and scroll it into view on navigation, including instrument/multiple-staff context.
- Define predictable multi-note selection rules; do not silently change a chord when only one pitch is selected.
- No Shift+Up/Down chord-component selection. Use Shift+click for the complete same-time chord column and Ctrl/Cmd+click for individual components.
- Group pitch edits preserve intervals and are atomic. Reject the complete edit on pitch collisions or range errors. Rests and unpitched percussion retain their pitch.
- Group selection blocks both shortening and lengthening, via controls and pointer gestures. No blue drag rectangle; selected measure backgrounds and noteheads show the selection.
- Whole-measure selections include all voices of that staff. Ranges cross intervening voices and instrument staves, using exact musical onsets rather than SVG order.
- Score history includes structural, pitch, duration, key/meter, title and written tempo edits. Keep current master volume and mixer presets/volume/pan/mute/solo through undo/redo, including restoration of a removed instrument.

### Touch / navigation

- Separate **edit mode** from **navigation (scroll/pan/zoom) mode**. Finger scrolling must not accidentally lengthen notes or change pitch. Use touch-friendly targets and contextual tools.
- Pen editing remains available without holding a mouse button or relying on handwriting recognition.
- Large blank score canvas, collapsible palettes and properties, with controls that do not obstruct gestures.

## Rhythmic invariants and behavior

- Preserve beat totals per voice/measure: shortening creates equivalent rest duration; lengthening may consume available subsequent rests without deleting sounded notes or silently crossing a barline.
- For lengthening past a note or barline, either provide a separately designed, explicitly invoked insert/ripple edit mode **or** reject safely; ordinary drag must not move following notes without an explicit mode.
- Ensure bracketed tuplets / ties are correctly handled if supported; never approximate unsupported durations or lose notation silently.
- Drag directions should be consistent across zoom, landscape/portrait and renderer changes, regardless of MuseScore C++ WASM vs VexFlow backend.

## Required automated acceptance coverage

1. Right/left duration direction, step snapping and minimum/maximum duration boundaries.
2. Up/down pitch sign and diatonic intervals across B–C / E–F and key signature contexts.
3. Default arrow chromatic semitone spelling, including partial chord/group edits; Shift+Left/Right range expansion and contraction.
4. Arrow left/right traverses notes/rests and crosses barlines and part/staff boundaries predictably.
5. Preview from original snapshot; no incremental drifting during pointer motion.
6. Axis selection/locking, small jitter threshold and diagonal motion.
7. Undo/redo records one entire drag operation, not one record per pointermove.
8. pointercancel/lostpointercapture/Escape/focus loss revert complete gesture.
9. Dragging a rest never changes pitch; duration edits preserve exact voice totals and don't erase a following note.
10. Touch navigation never fires edit actions; pointer identity and stylus handling exercised using Playwright's emulation.
11. Selection and editing still work after save/reload and after re-render.
12. Manual tests on **real Samsung Galaxy Tab + S Pen** must be logged separately; browser stylus emulation is not a substitute.

## Architectural placement

Implement input logic in an **InputController / GestureInterpreter** above the score command API. The controller dispatches semantic commands such as `ChangePitch`, `ChangeDuration`, `SelectEvent`, and `NavigateCursor`. Rendering engine integration must not directly own or reinterpret these gestures. This avoids losing the original PocketScore UX while adopting MuseScore's engraving/model implementation.

Current prototype references:
- `src/editor/gesture.ts`
- `src/editor/ScoreCanvas.tsx`
- `src/editor/state.ts`
- `src/music/score.ts`
- `src/editor/gesture.test.ts`, `src/editor/state.test.ts`

**Release blocker:** Do not ship the PocketScore 2.0 editor without basic horizontal-duration, vertical-pitch and arrow-key operations, regardless of how MuseScore-like its appearance becomes.
