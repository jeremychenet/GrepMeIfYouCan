import { defineConfig } from 'vitest/config';

// Coverage thresholds from SPEC §8.1. Never lower them to make a PR pass.
const CRITICAL = { lines: 95, functions: 95, branches: 95, statements: 95 };

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/lib/**/*.ts', 'src/content/*.ts', 'scripts/**/*.ts'],
      reporter: ['text', 'html', 'json-summary'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
        // Security-critical modules (more are added as they are created).
        'src/content/schema.ts': CRITICAL,
      },
    },
  },
});
