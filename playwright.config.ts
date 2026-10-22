import { defineConfig, devices } from '@playwright/test';

// iPhone (WebKit) checks of the built app. `npm run test:e2e` builds, serves and runs them.
export default defineConfig({
  testDir: 'e2e',
  use: { ...devices['iPhone 13'], baseURL: 'http://localhost:4173/gardenplanting/' },
  projects: [{ name: 'iphone-webkit', use: { ...devices['iPhone 13'] } }],
  webServer: { command: 'npx vite preview --port 4173 --strictPort', url: 'http://localhost:4173/gardenplanting/', reuseExistingServer: true },
});
