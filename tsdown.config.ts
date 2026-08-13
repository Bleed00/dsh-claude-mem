import { defineConfig } from 'tsdown'

/**
 * Self-contained build for a git install: transpiles `lib/types/*.js` (emitted
 * by `tsc`) into `lib/index.js` with no workspace globs, project references,
 * or monorepo plugins. `prepare` runs this after `tsc -p tsconfig.json`.
 */
export default defineConfig({
  entry: ['lib/types/index.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  dts: false,
  clean: false,
  fixedExtension: false,
})
