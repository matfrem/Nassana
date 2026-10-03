/// <reference types="vitest" />
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Relative base: works on GitHub Pages (https://<user>.github.io/Nassana/) and locally
export default defineConfig({
  base: './',
  plugins: [react()],
  test: {
    // Unit tests of the pure logic live next to the code. Browser tests are in tests/e2e (Playwright).
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
})
