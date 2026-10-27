import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

// This tool reads PUBLIC GPL-licensed MuseScore source text only.
// It never loads/executes MuseSampler binaries, downloads samples, or touches audio assets.
export const PINNED_UPSTREAM_SHA = '3654226c2e99289916916953a98e585a3d3b315a'
export const REQUIRED_SYMBOLS = Object.freeze([
  'ms_get_version_major',
  'ms_get_version_minor',
  'ms_get_version_revision',
  'ms_init_2',
  'ms_get_instrument_list',
  'ms_MuseSampler_create',
  'ms_MuseSampler_add_track',
  'ms_MuseSampler_add_track_note_event_6',
  'ms_MuseSampler_add_track_dynamics_event_2',
  'ms_MuseSampler_add_pitch_bend',
  'ms_MuseSampler_set_position',
  'ms_MuseSampler_process',
  'ms_MuseSampler_process_offline',
  'ms_MuseSampler_all_notes_off',
])
export const VERSION_GATES = Object.freeze(['0_102', '0_103', '0_104', '0_105'])

export function inspectPublicSources(handler, configure) {
  if (typeof handler !== 'string' || typeof configure !== 'string') {
    throw new TypeError('Provide two MuseScore source-file texts')
  }
  const match = 'if(BUILD_CONFIGURATION STREQUAL "APP-WEB")'
  const start = configure.indexOf(match)
  const end = configure.indexOf('# CONFIGURE: VTest', start)
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('Cannot isolate pinned APP-WEB configuration: source layout changed')
  }
  const webConfig = configure.slice(start, end)
  const symbols = [...new Set([...handler.matchAll(/libFunc\(\s*["'](ms_[A-Za-z0-9_]+)["']\s*\)/g)]
    .map(match => match[1]))].sort()
  const missingSymbols = REQUIRED_SYMBOLS.filter(symbol => !symbols.includes(symbol))
  const missingVersionGates = VERSION_GATES.filter(gate => !handler.includes('at_least_v_' + gate))
  const webMuseSamplerOff = /set\(\s*MUSE_MODULE_MUSESAMPLER\s+OFF\s*\)/.test(webConfig)
  const webMuseSoundsOff = /set\(\s*MUE_BUILD_MUSESOUNDS_MODULE\s+OFF\s*\)/.test(webConfig)

  return {
    schemaVersion: 1,
    evidenceLevel: 'STATIC_PUBLIC_SOURCE_ONLY',
    pinnedSourceCommit: PINNED_UPSTREAM_SHA,
    loaderSymbols: symbols,
    loaderSymbolCount: symbols.length,
    missingSymbols,
    versionGates: VERSION_GATES.filter(gate => !missingVersionGates.includes(gate)),
    missingVersionGates,
    webBuild: { museSamplerDisabled: webMuseSamplerOff, museSoundsDisabled: webMuseSoundsOff },
    sourceSha256: {
      libhandler: createHash('sha256').update(handler).digest('hex'),
      setupConfigure: createHash('sha256').update(configure).digest('hex'),
    },
    staticCheckPassed: missingSymbols.length === 0 && missingVersionGates.length === 0
      && webMuseSamplerOff && webMuseSoundsOff,
    proprietaryLibraryLoaded: false,
    actualAudioRendered: false,
    browserCompatibilityVerified: false,
    thirdPartyPermissionVerified: false,
  }
}

async function main() {
  const sourceRoot = process.argv[2]
  if (!sourceRoot) {
    throw new Error('Usage: node tools/musesampler-research/inspect.mjs /path/to/pinned/MuseScore')
  }
  const root = resolve(sourceRoot)
  const commit = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  if (commit !== PINNED_UPSTREAM_SHA) {
    throw new Error('Unexpected upstream revision: ' + commit + '; expected ' + PINNED_UPSTREAM_SHA)
  }
  const [handler, configure] = await Promise.all([
    readFile(resolve(root, 'src/framework/musesampler/internal/libhandler.h'), 'utf8'),
    readFile(resolve(root, 'SetupConfigure.cmake'), 'utf8'),
  ])
  const report = inspectPublicSources(handler, configure)
  console.log(JSON.stringify(report, null, 2))
  if (!report.staticCheckPassed) process.exitCode = 1
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => { console.error('MuseSampler public-source audit failed:', error.message); process.exitCode = 1 })
}
