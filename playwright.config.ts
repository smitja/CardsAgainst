import { defineConfig } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 4321);

export default defineConfig({
  testDir: 'e2e',
  timeout: 180_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    browserName: 'chromium',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node apps/server/dist/server.mjs',
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: false,
    env: {
      PORT: String(PORT),
      HOST: '127.0.0.1',
      STATIC_DIR: 'apps/web/dist',
      SQLITE_PATH: `test-results/e2e-${Date.now()}.db`,
    },
  },
});
