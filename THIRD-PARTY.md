# Third-party components and sound asset provenance

PocketScore 2 Alpha does **not** embed MuseScore's GPL C++ engine or Qt UI.
Source architecture was studied; the TypeScript implementation is independently
written. MuseScore's GPL code license does not license Muse Sounds/MuseSampler.
No Muse Sounds samples or proprietary binaries are included.

## MS Basic

- Upstream: MuseScore Studio **v4.7.5**, commit
  `3654226c2e99289916916953a98e585a3d3b315a`.
- Original path: [`share/sound/MS Basic.sf3`](https://github.com/musescore/MuseScore/blob/3654226c2e99289916916953a98e585a3d3b315a/share/sound/MS%20Basic.sf3).
- Bundled unchanged as `public/audio/MSBasic.sf3`, **51,278,610 bytes**.
- Git blob: `5be56b2fafa5eee347256cbe0d2fbfacd01702b6`.
- SHA-256: `5ea2375e8bd7d8e71def1036978c1621e85b66934169b6a2744b27b9b3c2d99c`.
- Exact adjacent upstream `MS Basic_License.md`, `MS Basic_Readme.md` and
  `MS_Basic_Changelog.md` are retained under `public/audio/` with descriptive
  filenames. Their original headings say “MuseScore_General.sf2”; those notices
  have deliberately not been rewritten to suggest a different license.
- Upstream's adjacent license explicitly grants **MIT** rights and requires
  the acknowledgements/copyright notices in derivative work. The full notices,
  permission and disclaimer are bundled in [MSBasic-LICENSE.md](public/audio/MSBasic-LICENSE.md).
  Authors include Frank Wen, Michael Cowgill, S. Christian Collins, Ethan Winer
  and Michael Schorsch. See the complete original acknowledgement list there.
- `SF_VERSION` in this pinned upstream tree is `0.2.0`.
- The app verifies size and SHA-256 before handing the asset to the decoder.
  Download/decoding happens only on first playback, and loading/error status is shown.

## Runtime libraries

| Package | Locked version | License | Distributed notice |
| --- | --- | --- | --- |
| spessasynth_lib | 4.3.14 | Apache-2.0 | `public/licenses/SpessaSynth-LICENSE` |
| spessasynth_core | 4.3.22 | Apache-2.0 | `public/licenses/SpessaSynth-core-LICENSE` |
| stb-vorbis | 0.0.6 | Apache-2.0 | `public/licenses/stb-vorbis-LICENSE` |
| VexFlow | 5.0.0 | MIT | `public/licenses/VexFlow-LICENSE` |

SpessaSynth's AudioWorklet performs actual sample synthesis; its Vorbis decoder
supports this SF3. These libraries are not modified. The npm lockfile pins the
transitive versions and registry integrity hashes. React/ReactDOM are MIT;
their existing package notices and bundled license comments are retained.

## Optional schema validation

MusicXML 4.0 schemas inspected in the pinned MuseScore tree are W3C MusicXML
specification files with their own W3C Community Final Specification Agreement
notice, not newly relicensed application code. They are used from an ignored
dependency cache for validation and are not bundled into the application.
