import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs', 'iife'],
  globalName: 'VectorAnimateWeb',
  dts: true,
  sourcemap: true,
  clean: true,
  minify: false,
  target: 'es2020',
  outDir: 'dist',
  // tsdown's callback receives Rolldown's internal format keys, where ESM
  // is reported as 'es' rather than 'esm'. tsdown also auto-inserts `.iife`
  // into the IIFE filename, so we leave that case to its default rather than
  // returning `.iife.js` and ending up with `.iife.iife.js`.
  outExtensions: ({ format }) => {
    if (format === 'es') return { js: '.js' };
    if (format === 'cjs') return { js: '.cjs' };
    return undefined;
  },
});
