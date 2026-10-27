// @ts-check
import { defineConfig } from 'astro/config';

// Fallback for macOS bind mounts: set WATCH_POLLING=true in .env
// if file changes are not picked up inside the container.
const usePolling = process.env.WATCH_POLLING === 'true';

export default defineConfig({
  server: { host: true, port: 4321 },
  // The dev toolbar injects an inline script, which our CSP forbids.
  devToolbar: { enabled: false },
  // Strict CSP in prod (style-src/script-src 'self'): never inline CSS or JS
  // into the HTML, always emit external files.
  build: { inlineStylesheets: 'never' },
  vite: {
    build: { assetsInlineLimit: 0 },
    server: {
      watch: usePolling ? { usePolling: true, interval: 300 } : {},
    },
  },
});
