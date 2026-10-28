// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import { siteUrl } from './src/lib/site.ts';

// Fallback for macOS bind mounts: set WATCH_POLLING=true in .env
// if file changes are not picked up inside the container.
const usePolling = process.env.WATCH_POLLING === 'true';

export default defineConfig({
  // Canonical URLs and sitemap; PUBLIC_BASE_URL defaults to the prod domain.
  site: siteUrl(process.env),
  // Pages are /c/<id>, not /c/<id>/ (SPEC §2.4): files are written as c/<id>.html.
  trailingSlash: 'never',
  integrations: [sitemap()],
  server: { host: true, port: 4321 },
  // The dev toolbar injects an inline script, which our CSP forbids.
  devToolbar: { enabled: false },
  // Strict CSP in prod (style-src/script-src 'self'): never inline CSS or JS
  // into the HTML, always emit external files.
  build: { format: 'file', inlineStylesheets: 'never' },
  vite: {
    build: { assetsInlineLimit: 0 },
    server: {
      watch: {
        // Playwright writes its reports here while `make e2e` runs.
        ignored: ['**/playwright-report/**', '**/test-results/**'],
        ...(usePolling ? { usePolling: true, interval: 300 } : {}),
      },
    },
  },
});
