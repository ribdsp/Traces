import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  test: {
    // jsdom, because the recorder patches browser globals — `window.fetch` and `XMLHttpRequest.prototype`
    // — and a teardown that restores them is only worth asserting against real ones.
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
