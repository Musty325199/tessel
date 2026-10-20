import { defineConfig, devices } from '@playwright/test';

// the first-time tour is tested on its own; everywhere else it starts as already seen
export const SEEN = { cookies: [], origins: [{ origin: 'http://localhost:4173', localStorage: [{ name: 'tessel:guide-seen', value: '1' }] }] };

// Runs the real app against a real API (in-memory database) in a real browser.
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
    use: { baseURL: 'http://localhost:4173', trace: 'retain-on-failure', storageState: SEEN },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'iphone', use: { ...devices['iPhone 13'], browserName: 'chromium' } },
  ],
  webServer: [
    { command: 'npx tsx src/index.ts', cwd: '../server', port: 8787, env: { PORT: '8787', CLIENT_ORIGIN: 'http://localhost:4173' }, reuseExistingServer: !process.env.CI },
    { command: 'npx vite build && npx vite preview --port 4173 --strictPort', port: 4173, env: { BASE_PATH: '/', VITE_API_URL: 'http://localhost:8787' }, reuseExistingServer: !process.env.CI },
  ],
});
