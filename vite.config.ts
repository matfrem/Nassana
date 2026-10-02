import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base relatif : fonctionne sur GitHub Pages (https://<user>.github.io/Nassana/) comme en local
export default defineConfig({
  base: './',
  plugins: [react()],
})
