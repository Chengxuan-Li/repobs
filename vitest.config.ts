import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const contracts = fileURLToPath(new URL('./packages/contracts/src/index.ts', import.meta.url))

export default defineConfig({
  resolve: { alias: { '@repobs/contracts': contracts } },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'node',
          include: ['tests/**/*.test.ts'],
          exclude: ['tests/**/*.int.test.ts', 'tests/e2e/**'],
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          environment: 'node',
          include: ['tests/**/*.int.test.ts'],
          exclude: ['tests/e2e/**'],
          testTimeout: 60_000,
          hookTimeout: 60_000,
        },
      },
      {
        extends: true,
        test: {
          name: 'web',
          environment: 'jsdom',
          include: ['apps/web/src/**/*.test.{ts,tsx}'],
          setupFiles: ['apps/web/src/testing/setup.ts'],
        },
      },
    ],
  },
})
