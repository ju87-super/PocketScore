import type { ReporterDescription } from '@playwright/test'
export const githubReporter = (): ReporterDescription[] => process.env.GITHUB_ACTIONS === 'true' ? [['github']] : []
