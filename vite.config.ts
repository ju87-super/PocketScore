import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// Keep the stable Pages build unchanged; beta artifacts use an explicit subpath.
const base = process.env.POCKETSCORE_BASE_PATH ?? '/PocketScore/'
if (!['/PocketScore/', '/PocketScore/beta/'].includes(base)) {
  throw new Error('Invalid POCKETSCORE_BASE_PATH: only stable or beta paths are allowed')
}

export default defineConfig({
  base,
  plugins: [react()],
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    clearMocks: true,
  },
})
