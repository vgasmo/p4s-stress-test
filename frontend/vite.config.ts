import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// O motor de cálculo vive no backend (ficheiros puros, sem Node) e é importado
// diretamente: o preview do wizard usa exatamente as mesmas regras que a API grava.
const backendSrc = path.resolve(__dirname, '../backend/src');

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@engine': backendSrc,
    },
  },
  server: {
    port: 5173,
    fs: { allow: [path.resolve(__dirname, '..')] },
    proxy: {
      '/api': { target: process.env.VITE_API_PROXY ?? 'http://localhost:3000', changeOrigin: false },
    },
  },
  preview: {
    port: 4173,
    proxy: {
      '/api': { target: process.env.VITE_API_PROXY ?? 'http://localhost:3000', changeOrigin: false },
    },
  },
});
