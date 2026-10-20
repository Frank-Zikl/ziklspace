import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';

const executablePath =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
  (!process.env.CI && existsSync('/usr/bin/chromium')
    ? '/usr/bin/chromium'
    : undefined);

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  workers: process.env.CI ? 2 : 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 90_000,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: { executablePath },
  },
  projects: [
    {
      name: 'desktop',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 1080 },
      },
    },
    {
      name: 'mobile',
      use: { ...devices['iPhone 13'], browserName: 'chromium' },
    },
  ],
  webServer: {
    command: 'node scripts/test-server.mjs',
    url: 'http://127.0.0.1:4173',
    timeout: 30_000,
    reuseExistingServer: false,
    env: { ASTRO_TELEMETRY_DISABLED: '1' },
  },
});
