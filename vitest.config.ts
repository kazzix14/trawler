import { defineConfig } from 'vitest/config';

// Pure-logic units only. We deliberately do NOT load the WxtVitest plugin:
// none of the tested modules import `#imports`/`browser`, and the plugin tries
// to reach the network on startup. Browser-coupled modules are verified via
// the build + manual load, not unit tests.
export default defineConfig({
  resolve: {
    alias: {
      '@': new URL('.', import.meta.url).pathname,
      '~': new URL('.', import.meta.url).pathname,
    },
  },
  test: {
    environment: 'jsdom',
    include: ['lib/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['lib/**/*.ts'],
      exclude: ['lib/**/*.test.ts', 'lib/**/types.ts'],
    },
  },
});
