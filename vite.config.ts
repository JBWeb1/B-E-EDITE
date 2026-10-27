import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Relative URLs, so the built app works from any folder (e.g. GitHub Pages at /<repo>/).
  base: './',
});
