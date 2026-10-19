import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// On GitHub Pages the site lives at /tessel/. Locally it is served from the root.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? (process.env.BASE_PATH ?? '/tessel/') : '/',
  plugins: [react()],
  server: { fs: { allow: ['..'] } },
}));
