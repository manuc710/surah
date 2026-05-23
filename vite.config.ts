import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Для GitHub Pages удобно использовать относительные пути,
  // чтобы сайт открывался как на корне, так и в /<repo>/.
  base: './',
})
