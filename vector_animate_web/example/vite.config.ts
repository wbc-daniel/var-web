import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath, URL } from 'node:url';

// Aliases the runtime to the parent's source so edits to the runtime
// reflect immediately without a rebuild step. For real consumers, the
// alias would be `vector-animate-web` resolved via node_modules.
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      'vector-animate-web': fileURLToPath(new URL('../src/index.ts', import.meta.url)),
    },
  },
});
