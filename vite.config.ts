import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  server: { port: 5174, strictPort: true },
  test: { environment: 'node', include: ['test/**/*.test.ts'] },
});
