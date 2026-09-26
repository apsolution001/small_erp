import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [tanstackRouter({ target: 'react', autoCodeSplitting: true }), react(), tailwindcss()],
  // Env comes from apps/web (Vite's default), never the API's root .env: its NODE_ENV would
  // turn a production build into a development one.
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
