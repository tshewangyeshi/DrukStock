import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:8770/', ...devices['Pixel 5'], viewport: { width: 360, height: 640 } },
  webServer: { command: 'node scripts/build.mjs --test && node scripts/serve.mjs dist-test 8770', url: 'http://127.0.0.1:8770/', reuseExistingServer: false },
});
