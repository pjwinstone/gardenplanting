import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

/** Project Pages URL: https://pjwinstone.github.io/gardenplanting/ */
const base = '/gardenplanting/';

export default defineConfig({
  base,
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        // Let MSAL redirect return URLs (code/state/error) hit the network/document
        // instead of a stale cached shell that can drop the auth response.
        navigateFallbackDenylist: [/\?code=/, /\?error=/, /\?state=/],
      },
      manifest: {
        name: 'Garden Survey',
        short_name: 'GardenSurvey',
        description: 'Chatty field survey PWA for a ~20×20 m UK garden',
        theme_color: '#1a3a2a',
        background_color: '#f3efe6',
        display: 'standalone',
        start_url: base,
        scope: base,
        icons: [
          {
            src: 'icon-192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'icon-512.png',
            sizes: '512x512',
            type: 'image/png',
          },
        ],
      },
    }),
  ],
});
