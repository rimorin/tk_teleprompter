/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';

// `pnpm dev:mobile` sets MOBILE=1: serve HTTPS on the local network so phones and tablets can
// use the microphone (browsers only allow getUserMedia on https:// or localhost).
const mobile = process.env.MOBILE === '1';

export default defineConfig({
  plugins: [react(), ...(mobile ? [basicSsl({ name: 'teleprompter-dev' })] : [])],
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
