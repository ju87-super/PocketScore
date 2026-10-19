import { defineConfig } from '@playwright/test'
if (!process.env.MUSESCORE_WEB_OUTPUT) throw new Error('Provide an actual MuseScore app-web build. A static probe fixture cannot run this test.')
export default defineConfig({ testDir: '.', workers: 1, timeout: 240000, retries: 0, forbidOnly: !!process.env.CI,
  outputDir: '../../test-results/wasm', reporter: [['list'], ['html', { outputFolder: 'reports/wasm/html', open: 'never' }], ['junit', { outputFile: 'reports/wasm/runtime.xml' }]],
  use: { baseURL: 'http://127.0.0.1:4180', viewport: { width: 1400, height: 1000 }, screenshot: 'only-on-failure', trace: 'retain-on-failure',
    launchOptions: { ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}), args: ['--enable-unsafe-swiftshader'] } },
  webServer: { command: 'node tools/musescore-web/serve.mjs', url: 'http://127.0.0.1:4180/runtime.html', reuseExistingServer: false },
})
