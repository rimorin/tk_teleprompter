// Production build: bundle the server and the workspace `@teleprompter/shared` package (which
// ships TypeScript source) into one CommonJS file that runs on plain Node — no tsx, no
// node_modules needed at runtime.
import { build } from 'esbuild';

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.cjs',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  sourcemap: true,
  legalComments: 'external',
  // Optional native accelerators for `ws`; it falls back to JS when they are absent.
  external: ['bufferutil', 'utf-8-validate'],
  logLevel: 'info',
});
