import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  test: {
    // jsdom, because compress-dom and the predicate evaluator both operate on real Elements.
    // The replayed document is a live DOM tree, so testing against strings would test a fiction.
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
