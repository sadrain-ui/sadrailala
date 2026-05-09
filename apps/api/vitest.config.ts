import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['src/tests/**/*.test.ts'],
    testTimeout: 180_000,
    hookTimeout: 60_000,
  },
})
