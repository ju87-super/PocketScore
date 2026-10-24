import { defineConfig } from '@playwright/test'
import { deploymentSettings } from './config'
export default defineConfig(deploymentSettings(process.env.POCKETSCORE_BASE_URL))
