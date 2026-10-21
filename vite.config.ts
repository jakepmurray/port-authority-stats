/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// GitHub Pages serves the app from /port-authority-stats/
const base = process.env.BASE_PATH ?? '/port-authority-stats/'

export default defineConfig({
  base,
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // 'prompt': a new deploy waits until the user clicks Reload (see src/ui/UpdatePrompt.tsx),
      // so nobody is stuck on a cached build and nobody loses a half-typed edit to a surprise reload.
      registerType: 'prompt',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Port Authority Stats',
        short_name: 'PA Stats',
        description: 'Free, open-source ultimate stats from game film.',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',
        start_url: base,
        scope: base,
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: { globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}'] },
    }),
  ],
  test: {
    environment: 'jsdom',
    setupFiles: ['src/test-setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
