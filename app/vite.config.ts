import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // The app is fully static and uses hash routing, so it can be served from any path.
  base: './',
});
