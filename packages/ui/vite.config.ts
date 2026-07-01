import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const defaultGalleryPort = 27185

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: defaultGalleryPort,
    strictPort: true
  }
})
