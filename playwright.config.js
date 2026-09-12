import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testIgnore: ['**/smoke.test.js', '**/todo-model.test.js', '**/todo-storage.test.js'],
  use: {
    baseURL: 'http://127.0.0.1:4173'
  },
  webServer: {
    command: 'python3 -m http.server 4173',
    url: 'http://127.0.0.1:4173',
    timeout: 10_000,
    reuseExistingServer: !process.env.CI
  }
});
