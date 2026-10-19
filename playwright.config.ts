import { defineConfig } from "@playwright/test";

const PORT = 8799;

export default defineConfig({
  testDir: "e2e",
  timeout: 90_000,
  use: { baseURL: `http://127.0.0.1:${PORT}`, channel: "chrome" },
  webServer: {
    // A fresh database every run. No token: the test fakes the server's GitHub proxy routes in the browser.
    command: "rm -rf .e2e-data && npm run build && npm run build:server && npm run selfhost",
    url: `http://127.0.0.1:${PORT}/api/instance`,
    env: { PORT: String(PORT), HOST: "127.0.0.1", DATA_DIR: ".e2e-data", DIST_DIR: "dist", GITHUB_TOKEN: "", SHARE_BASE_URL: "https://starvault.example.workers.dev" },
    timeout: 180_000,
    reuseExistingServer: false,
  },
});
