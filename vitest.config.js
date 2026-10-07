import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.js'],
    testTimeout: 120_000,
  },
});
