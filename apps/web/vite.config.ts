/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';

// `pnpm dev:mobile` sets MOBILE=1: serve HTTPS on the local network so phones and tablets can
// use the microphone (browsers only allow getUserMedia on https:// or localhost).
const mobile = process.env.MOBILE === '1';

/**
 * Link-preview tags need absolute URLs. Fill `__SITE_ORIGIN__` in index.html with VITE_PUBLIC_URL
 * when set (e.g. a static host), else with a Caddy template for the host each page is served from
 * (the web image), and with nothing in dev (relative URLs).
 */
function siteOrigin(): Plugin {
  let origin = '';
  return {
    name: 'site-origin',
    configResolved(config) {
      const configured = (config.env.VITE_PUBLIC_URL ?? '').trim().replace(/\/+$/, '');
      origin = config.command === 'serve' ? '' : configured || 'https://{{.Host}}';
    },
    transformIndexHtml: (html) => html.replaceAll('__SITE_ORIGIN__', origin),
  };
}

export default defineConfig({
  plugins: [react(), siteOrigin(), ...(mobile ? [basicSsl({ name: 'teleprompter-dev' })] : [])],
  server: {
    port: 5173,
    host: mobile ? true : 'localhost',
    proxy: {
      '/ws': { target: 'ws://127.0.0.1:8787', ws: true },
      '/health': 'http://127.0.0.1:8787',
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    // Vitest resolves packages like Node and ignores mammoth's "browser" field, so point tests
    // at mammoth's prebuilt browser bundle to exercise the same ArrayBuffer code path as the app.
    alias: { mammoth: 'mammoth/mammoth.browser.js' },
  },
});
