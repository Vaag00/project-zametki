import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      // Демо-сборка (VITE_DEMO=1) — одним файлом, чтобы её можно было встроить в одну страницу
      output: { inlineDynamicImports: process.env.VITE_DEMO === '1' },
    },
  },
  server: {
    // npm run dev: запросы к API и загруженным фото — на локальный сервер (server/, порт 8000)
    proxy: {
      '/api': 'http://127.0.0.1:8000',
      '/media': 'http://127.0.0.1:8000',
    },
  },
})
