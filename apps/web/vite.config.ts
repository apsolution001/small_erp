import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [tanstackRouter({ target: 'react', autoCodeSplitting: true }), react(), tailwindcss()],
  // One .env for the monorepo (repo root); only VITE_* variables reach the browser.
  envDir: fileURLToPath(new URL('../..', import.meta.url)),
  resolve: {
    conditions: ['@ekaro/source'],
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    port: 5173,
    // With VITE_API_BASE_URL unset the app calls `/api/v1` on its own origin; forward it.
    proxy: { '/api': process.env.API_PROXY_TARGET ?? 'http://localhost:3000' },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['src/test/setup.ts'],
    // Tests never read the developer's .env.
    env: { VITE_API_BASE_URL: '/api/v1' },
  },
});
