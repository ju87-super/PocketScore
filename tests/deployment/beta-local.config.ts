import { defineConfig } from '@playwright/test'
import { resolve } from 'node:path'
import { deploymentSettings } from './config'

export default defineConfig({
  ...deploymentSettings('http://127.0.0.1:4180/PocketScore/beta/', 'beta-preview-local'),
  testMatch: 'beta-preview.spec.ts',
  webServer: {
    command: 'npm run preview -- --host 127.0.0.1 --port 4180 --strictPort',
    cwd: resolve('.'),
    env: { POCKETSCORE_BASE_PATH: '/PocketScore/beta/' },
    url: 'http://127.0.0.1:4180/PocketScore/beta/',
    reuseExistingServer: false,
  },
})
