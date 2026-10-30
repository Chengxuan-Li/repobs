import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const backend = `http://127.0.0.1:${process.env.REPOBS_PORT ?? '47321'}`

export default defineConfig({
  plugins: [react()],
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: { '@repobs/contracts': fileURLToPath(new URL('../../packages/contracts/src/index.ts', import.meta.url)) },
  },
  build: { outDir: 'dist', emptyOutDir: true, sourcemap: false, chunkSizeWarningLimit: 900 },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    // The dev UI proxies the API so the browser talks to one origin; Host is preserved so the
    // backend's Host/Origin checks apply (it allows this dev origin via REPOBS_DEV_UI_ORIGIN).
    proxy: { '/api': { target: backend, changeOrigin: false, ws: false } },
  },
})
