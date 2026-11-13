import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the same build works at https://<user>.github.io/<repo>/ and from any sub-path.
  base: './',
  build: { target: 'es2022', chunkSizeWarningLimit: 1200 },
  server: { host: true },
  test: { include: ['tests/**/*.test.js'] },
});
