import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  // Relative base so the same build works at https://<user>.github.io/<repo>/ and from any sub-path.
  base: './',
  build: {
    target: 'es2022', chunkSizeWarningLimit: 3000,
    rollupOptions: { input: { main: resolve(import.meta.dirname, 'index.html'), poc: resolve(import.meta.dirname, 'poc.html') } },
  },
  worker: { format: 'es' },
  server: { host: true },
  test: { include: ['tests/**/*.test.js'] },
});
