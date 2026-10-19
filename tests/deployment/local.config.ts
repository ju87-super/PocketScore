import { defineConfig } from '@playwright/test'
import { deploymentSettings } from './config'
export default defineConfig({ ...deploymentSettings('http://127.0.0.1:4178/PocketScore/', 'deployment-local'),
  webServer: { command: 'npm run preview -- --host 127.0.0.1 --port 4178 --strictPort', url: 'http://127.0.0.1:4178/PocketScore/', reuseExistingServer: false },
})
