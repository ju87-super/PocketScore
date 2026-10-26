import assert from 'node:assert/strict'
import test from 'node:test'
import { inspectPublicSources, PINNED_UPSTREAM_SHA, REQUIRED_SYMBOLS, VERSION_GATES } from './inspect.mjs'

const source = () => [
  ...REQUIRED_SYMBOLS.map(symbol => 'const fn = libFunc("' + symbol + '");'),
  ...VERSION_GATES.map(gate => 'bool at_least_v_' + gate + ' = true;'),
].join('\n')
const configure = () => [
  'if(BUILD_CONFIGURATION STREQUAL "APP-WEB")',
  'set(MUSE_MODULE_MUSESAMPLER OFF)',
  'set(MUE_BUILD_MUSESOUNDS_MODULE OFF)',
  'endif()',
  '# CONFIGURE: VTest',
].join('\n')

test('inspects public source only, never claims a runtime or rights verification', () => {
  const report = inspectPublicSources(source(), configure())
  assert.equal(report.staticCheckPassed, true)
  assert.equal(report.evidenceLevel, 'STATIC_PUBLIC_SOURCE_ONLY')
  assert.equal(report.pinnedSourceCommit, PINNED_UPSTREAM_SHA)
  assert.equal(report.loaderSymbolCount, REQUIRED_SYMBOLS.length)
  assert.deepEqual(report.missingSymbols, [])
  assert.deepEqual(report.missingVersionGates, [])
  assert.equal(report.webBuild.museSamplerDisabled, true)
  assert.equal(report.webBuild.museSoundsDisabled, true)
  for (const field of ['proprietaryLibraryLoaded', 'actualAudioRendered', 'browserCompatibilityVerified', 'thirdPartyPermissionVerified']) {
    assert.equal(report[field], false, field)
  }
})

test('missing public loader symbol produces a failed static check', () => {
  const altered = source().replace('libFunc("ms_MuseSampler_process")', 'missingExport')
  const report = inspectPublicSources(altered, configure())
  assert.equal(report.staticCheckPassed, false)
  assert.deepEqual(report.missingSymbols, ['ms_MuseSampler_process'])
})

test('changed MuseSampler web-build gating cannot pass unnoticed', () => {
  const altered = configure().replace('MUSE_MODULE_MUSESAMPLER OFF', 'MUSE_MODULE_MUSESAMPLER ON')
  const report = inspectPublicSources(source(), altered)
  assert.equal(report.staticCheckPassed, false)
  assert.equal(report.webBuild.museSamplerDisabled, false)
})

test('missing version guard is reported', () => {
  const altered = source().replace('bool at_least_v_0_105 = true;', '')
  const report = inspectPublicSources(altered, configure())
  assert.equal(report.staticCheckPassed, false)
  assert.deepEqual(report.missingVersionGates, ['0_105'])
})

test('changed APP-WEB structure fails closed', () => {
  assert.throws(() => inspectPublicSources(source(), 'set(MUSE_MODULE_MUSESAMPLER OFF)'), /APP-WEB configuration/)
  assert.throws(() => inspectPublicSources(null, configure()), /two MuseScore source-file texts/)
})
