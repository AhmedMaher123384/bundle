import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'https://d76e88236c49.ngrok-free.app',
        changeOrigin: true,
      },
    },
  },
})

