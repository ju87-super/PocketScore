const unit = (suite, ...filters) => [process.execPath, 'node_modules/vitest/vitest.mjs', 'run', ...filters,
  '--reporter=default', '--reporter=junit', '--reporter=json',
  `--outputFile.junit=reports/${suite}/junit.xml`, `--outputFile.json=reports/${suite}/vitest.json`]
export const suites = {
  quality: [
    ['bash', 'tools/ci/check-workflows.sh'],
    [process.execPath, 'tools/ci/inventory.mjs'],
    [process.execPath, '--test', 'tools/ci/contracts.test.mjs', 'tools/musescore-web/probe.test.mjs'],
    ['npm', 'run', 'typecheck'], ['npm', 'run', 'lint'], ['npm', 'run', 'build'],
    ['git', 'diff', '--exit-code', '--', 'package.json', 'package-lock.json'],
  ],
  music: [unit('music', 'src/music', 'src/project')],
  input: [unit('input', 'src/editor', 'src/App.test.tsx')],
  playback: [unit('playback', 'src/playback')],
  musicxml: [unit('musicxml', 'src/files')],
  browser: [['npm', 'run', 'build'], ['npx', '--no-install', 'playwright', 'test', '--project=chromium']],
  audio: [[process.execPath, 'tools/ci/verify-sound.mjs'], ['npm', 'run', 'build'], ['npx', '--no-install', 'playwright', 'test', '--project=audio']],
  // Explicit negative path; never part of the successful validation suite.
  'failure-probe': [[process.execPath, '-e', 'console.error("Intentional CI failure probe"); process.exit(17)']],
}
