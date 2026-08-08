import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Tests cover the pure sequencer/pitch/export layer only, which needs no DOM.
  // Restricting to .ts (not .tsx) keeps jsdom out of the dependency tree.
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
