import { createApp } from "./app.js";
import { createAuthProvider } from "./auth/index.js";
import { configFromEnv } from "./config.js";
import { startServer } from "./core/kit/index.js";
import { env } from "./env.js";
import { loadGpuGate } from "./jobs/loadGpuGate.js";
import { createAppServices } from "./services.js";

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
