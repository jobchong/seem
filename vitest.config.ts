import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const rootDir = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@seem/adapters-browser': fileURLToPath(
        new URL('./packages/adapters-browser/src/index.ts', import.meta.url),
      ),
      '@seem/core': fileURLToPath(
        new URL('./packages/core/src/index.ts', import.meta.url),
      ),
      '@seem/shared-test-utils': fileURLToPath(
        new URL('./packages/shared-test-utils/src/index.ts', import.meta.url),
      ),
    },
  },
  test: {
    environment: 'node',
    include: ['packages/*/test/**/*.test.ts'],
    root: rootDir,
  },
});
