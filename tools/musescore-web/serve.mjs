import { createServer } from 'node:http'
import { createReadStream } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { resolve, extname, sep } from 'node:path'
const root = resolve(process.env.MUSESCORE_WEB_OUTPUT ?? '')
if (!process.env.MUSESCORE_WEB_OUTPUT) throw new Error('Set actual compiled MUSESCORE_WEB_OUTPUT; no fixture engine is supplied.')
const mime = { '.wasm': 'application/wasm', '.js': 'text/javascript', '.html': 'text/html', '.json': 'application/json' }
createServer(async (request, response) => {
  try {
    const path = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname)
    const file = resolve(root, '.' + path)
    if (!file.startsWith(root + sep)) throw new Error('Invalid path')
    response.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
    response.setHeader('Cross-Origin-Embedder-Policy', 'require-corp')
    if (path === '/runtime.html') { response.setHeader('Content-Type', 'text/html'); response.end(await readFile('tools/musescore-web/runtime.html')); return }
    const info = await stat(file)
    if (!info.isFile()) throw new Error('Not a file')
    response.setHeader('Content-Type', mime[extname(file)] ?? 'application/octet-stream')
    response.setHeader('Content-Length', info.size)
    createReadStream(file).pipe(response)
  } catch { response.writeHead(404); response.end('Missing actual WASM artifact') }
}).listen(4180, '127.0.0.1')
