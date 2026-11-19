// End-to-end testy (Playwright): sestavený frontend z public/ v Chromiu,
// Firebase a síť nahrazené atrapou (test/e2e/support), syntetická data.
// Spuštění: npm run test:e2e   (prohlížeč jednou: npx playwright install chromium)
const { defineConfig, devices } = require('@playwright/test');

const PORT = Number(process.env.E2E_PORT || 4173);
const CI = !!process.env.CI;

module.exports = defineConfig({
  testDir: './test/e2e',
  testMatch: '**/*.spec.js',
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  workers: CI ? 2 : undefined,
  timeout: 30_000,
  expect: { timeout: 7_000 },
  // Celkový strop, aby reportér stihl zapsat výsledek i při zaseknutí
  globalTimeout: 15 * 60_000,
  reporter: CI
    ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }], ['github']]
    : [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  outputDir: 'test-results',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    locale: 'cs-CZ',
    timezoneId: 'Europe/Prague',
    // Service worker by cachoval soubory mezi testy a obcházel page.route
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'mobil',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
  ],
  webServer: {
    command: 'node test/e2e/support/static-server.js',
    url: `http://127.0.0.1:${PORT}/index.html`,
    reuseExistingServer: !CI,
    env: { E2E_PORT: String(PORT) },
    timeout: 20_000,
  },
});
