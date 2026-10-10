import type { CapacitorConfig } from '@capacitor/cli';

/**
 * iOS shell for the same Vite app GitHub Pages deploys.
 * Pages keeps `base: /gardenplanting/`. The iOS build (`npm run build:ios`)
 * uses a relative base so WKWebView can load the assets.
 */
const config: CapacitorConfig = {
  appId: 'com.pjwinstone.gardenplanting',
  appName: 'Garden Planting',
  webDir: 'dist',
  ios: {
    contentInset: 'automatic',
    backgroundColor: '#1a3a2a',
  },
};

export default config;
