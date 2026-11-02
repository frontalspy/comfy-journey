import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Express } from "express";
import { vi } from "vitest";
import type { AuthSettings } from "../auth/index.js";

/** The one user of the default test app, and the secret that proves it. */
export const TEST_USER = "alice";
export const TEST_SECRET = "test-secret-0123456789";

const DEFAULT_AUTH: AuthSettings = {
  mode: "token",
  host: "127.0.0.1",
  allowNoAuthOnNetwork: false,
  header: "x-forwarded-user",
  trustedProxies: ["127.0.0.1", "::1"],
  tokens: `${TEST_USER}=${TEST_SECRET}`,
};

/**
 * Boots the real app (real auth gate, no test identity shortcut) with the given env and auth
 * settings. Modules read env on import, so they are reset and imported dynamically after the
 * variables are set; `cleanup` restores the previous values. Defaults to token auth with one user.
 */
export async function createTestApp(
  overrides: Record<string, string | undefined> = {},
  auth: Partial<AuthSettings> = {},
): Promise<{ app: Express; cleanup: () => void }> {
  const values: Record<string, string | undefined> = { NODE_ENV: "test", ...overrides };
  const previous: Record<string, string | undefined> = {};
  const restore = (): void => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
  for (const [key, value] of Object.entries(values)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.resetModules();
  try {
    const { createApp } = await import("../app.js");
    const { createAuthProvider } = await import("../auth/index.js");
    const { createAppServices } = await import("../services.js");
    const { MemoryGpuGate } = await import("../jobs/memoryGpuGate.js");
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "comfy-gate-"));
    const services = await createAppServices(
      {
        dataDir,
        comfyUrl: "http://127.0.0.1:9",
        workflowsDir: path.join(dataDir, "workflows"),
        allowNsfwWorkflows: true,
      },
      { gate: new MemoryGpuGate() },
    );
    const provider = await createAuthProvider({ ...DEFAULT_AUTH, ...auth });
    const cleanup = (): void => {
      restore();
      void services.stop().then(() => removeQuietly(dataDir));
    };
    return { app: createApp(services, { provider, secureCookie: false }), cleanup };
  } catch (err) {
    restore();
    throw err;
  }
}

/** Windows can briefly hold the SQLite file after close; the OS temp dir is swept anyway. */
export function removeQuietly(target: string): void {
  try {
    fs.rmSync(target, { recursive: true, force: true });
  } catch {
    // ignored on purpose
  }
}
