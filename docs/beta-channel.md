# PocketScore 2.1 Beta — isolated channel

**Status:** Beta CI + production-static-artifact smoke testing; **not yet a public beta website**.

## Release isolation

- `main`: stable Alpha at https://ju87-super.github.io/PocketScore/ (the existing Pages CD is main-only).
- `beta/2.1`: experimental editor/audio development. Beta's ordinary Validate 8-check suite runs after every beta push; pull requests run it too.
- `.github/workflows/beta-preview.yml`: builds a separately branded 2.1 Beta version, validates the actual built HTML/JS/CSS/MS Basic SF3 and editor in Chromium, then uploads a **downloadable static-site Actions artifact**. It does **not** call `actions/deploy-pages` and cannot overwrite the main site.
- Future beta work merges into `beta/2.1` first; only a separately approved release PR may move stable code to main.
- PR #8 MuseSampler public API research should target `beta/2.1`. The technical research does not authorize or implement actual Muse Sounds playback.

## Build and artifact location

Workflow: https://github.com/ju87-super/PocketScore/actions/workflows/beta-preview.yml

The build uses `POCKETSCORE_BASE_PATH=/PocketScore/beta/` and produces a self-contained site in `dist/`:
- `/PocketScore/beta/assets/...`
- `/PocketScore/beta/audio/MSBasic.sf3`
- `/PocketScore/beta/build-info.json` listing the source commit, base path and SHA-256 of each critical asset

The manifest and decoded HTTP content must match the build. Playwright tests beta route rendering, note editing, Undo and the actual audio bank bytes. Beta builds show a visible **2.1 Beta** badge, but stable builds retain the existing header.

To inspect a completed run: open its **Artifacts** section and download `beta-preview-site-<SHA>`. **An artifact is not itself a hosted public website**. The CI browser checks use the local Vite production preview server. A local Node development installation is required for an unpacked artifact; opening index.html through file:// is not a supported playback test.

### Local reproduction

```sh
git switch beta/2.1
npm ci
POCKETSCORE_BASE_PATH=/PocketScore/beta/ npm run build
POCKETSCORE_BASE_PATH=/PocketScore/beta/ node tools/ci/pages-build.mjs dist
npx playwright install chromium
POCKETSCORE_EXPECTED_SHA=$(git rev-parse HEAD) npx playwright test --config tests/deployment/beta-local.config.ts
```

The 51.3 MB MS Basic SoundFont is required for the preview sound integrity test. The production site and beta site use the same unmodified, licensed SoundFont; no Muse Sounds binaries or samples are included.

## Separate public beta website — deployment options

**Do not** run a second independent `actions/deploy-pages` workflow inside this repository: GitHub Pages serves **one site per repository**, and it would overwrite the stable deployment. Two safe approaches:

1. **Separate hosting project** (recommended): connect the `beta/2.1` branch to a separate Cloudflare Pages/Netlify project owned by the user; configure a beta-specific domain, Node.js 24 / compatible npm, build command `npm ci && npm run build && node tools/ci/pages-build.mjs dist`, output directory `dist`, and `POCKETSCORE_BASE_PATH=/`. This repository now explicitly supports a root-path beta build. Check the service's supported runtime and build settings when setting it up; the user must connect and authorize the service. No external account, site, or secrets are created by this research commit.
2. **One combined Pages artifact** containing stable at `/PocketScore/` and beta under `/PocketScore/beta/`. This requires an **explicitly reviewed change to the main deployment workflow**, downloading and verifying the two independent branch commits before any publication, passing both prod and beta E2E tests, then atomic deployment and rollback. This approach is possible but more coupled and risks stable release availability on deployment errors. **Not implemented.**

Never describe https://ju87-super.github.io/PocketScore/beta/ as live until a validated workflow actually publishes a combined Pages artifact. No Pages environment or repository settings were changed in this commit.

## Validation/release gates

- Beta push `Validate` required `check` is successful; skipped/cancelled jobs must not count.
- `Beta Preview Artifact` job passes actual production browser smoke and reports verified source SHA. CI cannot claim physical Galaxy Tab/S Pen behavior without device tests.
- Beta's score schema and import/export may advance, but migrations/backward-compatible file opening should be confirmed before stable promotion.
- Experimental MuseSampler/Sounds remains capability-gated and absent from the public build without an explicitly permitted SDK and distribution/hosting rights.
- Stable release to `main` only after user-authorized PR, Playwright audio/score regression, manual tablet validation, and release notes.

**Branch protection suggestion:** GitHub Settings → Rules → Rulesets: require pull requests and required `check` for `beta/2.1`. The separate `Beta build and browser smoke` check is useful to require as well once registered by GitHub. Avoid requiring a second person's review if the repository has a single maintainer.
