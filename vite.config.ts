import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Relative base: works on GitHub Pages (https://<user>.github.io/Nassana/) and locally
export default defineConfig({
  base: './',
  plugins: [react()],
})
