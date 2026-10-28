import { defineConfig, devices } from '@playwright/test';

// End-to-end tests (SPEC §8.1). Two ways to run them:
// - `make e2e`: the `e2e` Compose service sets E2E_BASE_URL to the dev stack
//   (proxy on localhost:8080, shared network namespace);
// - CI: no E2E_BASE_URL, so Playwright serves the built dist/ with
//   `astro preview` (run `npm run build` first).
const external = process.env['E2E_BASE_URL'];
const ci = !!process.env['CI'];
const PREVIEW_URL = 'http://localhost:4321';

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: ci,
  // Tests must be deterministic: a flaky test is fixed, not retried.
  retries: 0,
  reporter: [[ci ? 'github' : 'list'], ['html', { open: 'never' }]],
  ...(external ? { globalSetup: './tests/e2e/wait-for-site.ts' } : {}),
  use: {
    baseURL: external ?? PREVIEW_URL,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], permissions: ['clipboard-read', 'clipboard-write'] },
    },
  ],
  ...(external
    ? {}
    : {
        webServer: {
          command: 'npm run preview -- --port 4321',
          url: PREVIEW_URL,
          reuseExistingServer: !ci,
        },
      }),
});
