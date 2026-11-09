import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// `npm run dev` serves the UI with hot reload and forwards /api to a running
// `babel-room ui` (default port 4400). changeOrigin rewrites the Host header,
// which the API server checks.
export default defineConfig({
  plugins: [react()],
  base: '/',
  build: { outDir: 'dist', emptyOutDir: true, sourcemap: false },
  server: {
    proxy: { '/api': { target: 'http://127.0.0.1:4400', changeOrigin: true } }
  }
})
