import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// En développement, l'API et le WebSocket du serveur Node (port 3000) sont proxifiés
// afin que le client se comporte comme en production (même origine).
export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': 'http://localhost:3000',
      '/uploads': 'http://localhost:3000',
      '/ws': { target: 'ws://localhost:3000', ws: true },
    },
  },
  build: {
    target: 'es2020',
    sourcemap: false,
    chunkSizeWarningLimit: 3000,
  },
});
