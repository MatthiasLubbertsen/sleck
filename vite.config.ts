import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  root: 'web',
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./web/src', import.meta.url)) } },
  build: { outDir: '../dist/web', emptyOutDir: true, sourcemap: false },
  server: {
    port: 5173,
    proxy: {
      // ws: the realtime socket lives at /api/ws; the Origin header is left as-is so the server's origin check passes
      '/api': { target: 'http://localhost:3000', changeOrigin: false, ws: true },
      '/auth': { target: 'http://localhost:3000', changeOrigin: false },
    },
  },
  test: { root: '.', include: ['{web,server,shared}/**/*.test.ts'] },
})
