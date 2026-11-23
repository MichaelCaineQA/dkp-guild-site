import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: process.env.E2E_BASE_URL
    ? 'deployed.spec.ts'
    : ['business.spec.ts', 'statistics.spec.ts'],
  fullyParallel: false,
  workers: 1,
  use: { baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3090', trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    ...(process.env.E2E_BASE_URL
      ? []
      : [
          {
            name: 'mobile-chromium',
            testMatch: 'business.spec.ts',
            grep: /@mobile/,
            use: { ...devices['Pixel 7'], colorScheme: 'dark' as const },
          },
          {
            name: 'mobile-webkit',
            testMatch: 'business.spec.ts',
            grep: /@mobile/,
            use: { ...devices['iPhone 13'], colorScheme: 'light' as const },
          },
        ]),
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : [
        {
          command: 'pnpm -C apps/api exec ts-node src/main.ts',
          url: 'http://localhost:3001/health',
          timeout: 120000,
          env: {
            AUTH_TEST_MODE: 'true',
            NODE_ENV: 'test',
            AUCTION_CLOSE_INTERVAL_MS: '0',
            DATABASE_URL:
              process.env.DATABASE_URL ??
              'postgresql://dkp:dkp@127.0.0.1:5432/dkp_test?schema=public',
          },
        },
        {
          command: 'pnpm -C apps/web exec next dev -p 3090',
          url: 'http://localhost:3090',
          timeout: 120000,
          env: { NODE_ENV: 'development' },
        },
      ],
});
