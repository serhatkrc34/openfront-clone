import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  server: {
    port: 3000,
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
  resolve: {
    alias: {
      '@openfront/core': resolve(__dirname, '../core/src/index.ts'),
    },
  },
});
