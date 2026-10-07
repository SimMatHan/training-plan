import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// Version vist i Indstillinger. Workers Builds sætter WORKERS_CI_COMMIT_SHA.
const buildId = (process.env.WORKERS_CI_COMMIT_SHA ?? 'lokal').slice(0, 7);

export default defineConfig({
  define: {
    __BUILD_ID__: JSON.stringify(buildId),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // Ny version hentes i baggrunden, men aktiveres først når brugeren trykker "Opdater".
      registerType: 'prompt',
      includeAssets: ['favicon.ico', 'icon.svg', 'apple-touch-icon-180x180.png'],
      manifest: {
        id: '/',
        name: 'Træningsnav',
        short_name: 'Træning',
        description: 'Træningsplan, logning og progression',
        lang: 'da',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#EEF0EF',
        theme_color: '#23262A',
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // App-skallen caches; data caches i IndexedDB (Dexie), ikke i service workeren.
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        globIgnores: ['**/*vietnamese*'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/cal\//],
        cleanupOutdatedCaches: true,
        // Første installation overtager siden med det samme (offline fra første besøg).
        // Senere versioner venter stadig på "Opdater" (skipWaiting er slået fra).
        clientsClaim: true,
      },
    }),
  ],
  server: {
    proxy: { '/api': 'http://localhost:8787', '/cal': 'http://localhost:8787' },
  },
});
