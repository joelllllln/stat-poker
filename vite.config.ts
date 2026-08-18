import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  // Relative asset paths, so the built app runs from wherever it is served:
  // the root in development, and a repository subpath on GitHub Pages.
  base: './',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
    // Exhaustive and simulation-based tests run for minutes by design.
    testTimeout: 300_000,
    hookTimeout: 300_000,
    teardownTimeout: 60_000,
  },
})
