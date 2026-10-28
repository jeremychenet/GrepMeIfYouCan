// Global setup for `make e2e`: waits until the dev server answers, and makes
// it compile the pages once, so the first tests do not hit a cold server.
import type { FullConfig } from '@playwright/test';

const TIMEOUT_MS = 90_000;
const WARM_UP = ['/', '/search-index.json', '/tools/find', '/c/find-files-larger-than'];

async function ok(url: string): Promise<boolean> {
  try {
    return (await fetch(url)).ok;
  } catch {
    return false;
  }
}

export default async function waitForSite(config: FullConfig): Promise<void> {
  const base = config.projects[0]!.use.baseURL!;
  const deadline = Date.now() + TIMEOUT_MS;
  for (const path of WARM_UP) {
    while (!(await ok(new URL(path, base).href))) {
      if (Date.now() > deadline) throw new Error(`e2e: ${base}${path} did not answer within ${TIMEOUT_MS} ms`);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
}
