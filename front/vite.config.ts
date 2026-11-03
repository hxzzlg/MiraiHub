import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

// 开发代理与生产接线对齐：/api、/static、/authorize 都指向 8790 后端。
const backend = process.env.MIRAIHUB_BACKEND || 'http://127.0.0.1:8790'

export default defineConfig({
  plugins: [react()],
  // 产物挂在 /admin/ 前缀下，由后端 /admin/assets/{path} 路由下发（公开，门禁在 API 层）
  base: '/admin/',
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: backend, changeOrigin: true },
      '/static': { target: backend, changeOrigin: true },
      '/authorize': { target: backend, changeOrigin: true },
    },
  },
  build: {
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
        join: path.resolve(__dirname, 'join.html'),
      },
    },
  },
})
