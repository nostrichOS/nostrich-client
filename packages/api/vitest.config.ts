import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // The environment this code actually runs.
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
