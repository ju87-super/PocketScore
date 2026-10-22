import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// A separate build: fixture controls are never shipped in the application.
export default defineConfig({
  plugins: [react()], base: '/',
  build: { outDir: '.cache/performance-site', emptyOutDir: true,
    rollupOptions: { input: 'tests/performance/index.html' } },
})
