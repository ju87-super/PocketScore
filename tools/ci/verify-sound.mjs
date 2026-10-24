import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
const bytes = await readFile('public/audio/MSBasic.sf3')
if (bytes.length !== 51278610 || createHash('sha256').update(bytes).digest('hex') !== '5ea2375e8bd7d8e71def1036978c1621e85b66934169b6a2744b27b9b3c2d99c') throw new Error('MS Basic asset integrity failed')
console.log('Verified licensed MS Basic asset; required only for real PCM integration / production deployment.')
