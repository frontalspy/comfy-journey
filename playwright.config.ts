import fs from "node:fs";
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

// Browser tests run the real app against the fake ComfyUI (`npm run fake-comfy`), so they need no
// GPU and no ComfyUI install. Build first (`npm run build`): the server hosts the built web app.
const APP_PORT = 3100;
const FAKE_COMFY_PORT = 8199;
const dataDir = path.resolve("e2e/data");
// The config is loaded again inside each test worker, when the server already holds the database.
if (!process.env.TEST_WORKER_INDEX) fs.rmSync(dataDir, { recursive: true, force: true });

export default defineConfig({
  testDir: "e2e",
  workers: 1,
  fullyParallel: false,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL: `http://127.0.0.1:${APP_PORT}`, trace: "retain-on-failure" },
  projects: [
    // The installed Chrome is used so no browser download is needed; CI runners have it too.
    { name: "desktop", use: { ...devices["Desktop Chrome"], channel: "chrome" } },
    {
      name: "phone",
      use: { ...devices["Pixel 7"], channel: "chrome", viewport: { width: 360, height: 740 } },
    },
  ],
  webServer: [
    {
      command: "npm run fake-comfy",
      url: `http://127.0.0.1:${FAKE_COMFY_PORT}/system_stats`,
      reuseExistingServer: !process.env.CI,
      env: { FAKE_COMFY_PORT: String(FAKE_COMFY_PORT) },
    },
    {
      command: "npm run start --workspace=server",
      url: `http://127.0.0.1:${APP_PORT}/api/health`,
      reuseExistingServer: !process.env.CI,
      env: {
        PORT: String(APP_PORT),
        HOST: "127.0.0.1",
        NODE_ENV: "production",
        AUTH_MODE: "none",
        COMFYUI_URL: `http://127.0.0.1:${FAKE_COMFY_PORT}`,
        DATA_DIR: dataDir,
        WORKFLOWS_DIR: path.resolve("workflows"),
      },
    },
  ],
});
