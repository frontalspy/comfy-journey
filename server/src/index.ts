import { createApp } from "./app.js";
import { createAuthProvider } from "./auth/index.js";
import { configFromEnv } from "./config.js";
import { startServer } from "./core/kit/index.js";
import { env } from "./env.js";
import { loadGpuGate } from "./jobs/loadGpuGate.js";
import { createAppServices } from "./services.js";

// Following a job needs the built-in WebSocket (Node 22 or newer). Fail now, with the fix, rather
// than failing every job later.
if (typeof (globalThis as { WebSocket?: unknown }).WebSocket !== "function") {
  console.error(
    `Comfy needs Node 22 or newer (built-in WebSocket); this is Node ${process.versions.node}. Install Node 22 and point the service at it.`,
  );
  process.exit(1);
}

const config = configFromEnv(env);
const provider = await createAuthProvider({
  mode: env.AUTH_MODE,
  host: env.HOST,
  allowNoAuthOnNetwork: env.AUTH_NONE_ALLOW_NETWORK,
  header: env.AUTH_HEADER,
  trustedProxies: env.TRUSTED_PROXIES,
  tokens: env.AUTH_TOKENS,
  module: env.AUTH_MODULE,
});
const services = await createAppServices(config, { gate: await loadGpuGate(env.GPU_GATE_MODULE) });
await services.start();

startServer({
  app: createApp(services, { provider, secureCookie: env.NODE_ENV === "production" }),
  name: "comfy",
  port: env.PORT,
  host: env.HOST,
  backup: { service: services.backup, runScheduler: env.RUN_BACKUP_SCHEDULER === "true" },
  onShutdown: () => services.stop(),
});
console.log(`Auth: ${provider.name}`);
