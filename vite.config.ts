import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * GitHub Pages: https://pjwinstone.github.io/gardenplanting/
 * Capacitor (`VITE_CAPACITOR=1`, `npm run build:ios`) uses a relative base
 * so the same app loads inside WKWebView. The Pages workflow does not set
 * that variable, so its `dist` and deploy stay on `/gardenplanting/`.
 */
const capacitor = process.env.VITE_CAPACITOR === '1';
const base = capacitor ? './' : '/gardenplanting/';

export default defineConfig({
  base,
  plugins: capacitor
    ? []
    : [
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        // Let MSAL redirect return URLs (code/state/error) hit the network/document
        // instead of a stale cached shell that can drop the auth response.
        navigateFallbackDenylist: [/\?code=/, /\?error=/, /\?state=/],
      },
      manifest: {
        name: 'Garden Planting',
        short_name: 'GardenPlanting',
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
