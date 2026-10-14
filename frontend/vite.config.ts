import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// In dev, the Django API runs on :8000. Proxying /api keeps the app same-origin,
// mirroring production where CloudFront routes /api/* to the ALB.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:8000', changeOrigin: false },
    },
  },
})
