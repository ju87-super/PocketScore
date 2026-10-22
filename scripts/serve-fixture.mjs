import { build, preview } from 'vite'
const configFile = 'tests/performance/vite.config.ts'
await build({ configFile, logLevel: 'error' })
const server = await preview({ configFile, preview: { host: '127.0.0.1', port: 4176, strictPort: true } })
const close = () => server.httpServer.close(() => process.exit(0))
process.on('SIGTERM', close)
process.on('SIGINT', close)
