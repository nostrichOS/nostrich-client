import { defineConfig } from 'vitest/config'

/** Tests for the web app's logic. */
export default defineConfig({
  test: {
    environment: 'jsdom',
    // See test/setup.ts.
    setupFiles: ['./test/setup.ts'],
    include: ['lib/**/*.test.ts'],
    // Each file gets a clean localStorage.
    isolate: true,
    restoreMocks: true,
  },
})
