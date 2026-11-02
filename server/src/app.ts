import fs from "node:fs";
import path from "node:path";
import type { Express } from "express";
import { type AuthProvider, createAuthGate } from "./auth/index.js";
import { createHttpApp } from "./core/kit/index.js";
import { mountSpaHosting } from "./core/spa.js";
import { env } from "./env.js";
import { apiRoutes } from "./routes/index.js";
import type { AppServices } from "./services.js";

export interface AppAuth {
  provider: AuthProvider;
  /** Marks the session cookie Secure; true whenever the app is served over https. */
  secureCookie: boolean;
}

export function createApp(services: AppServices, auth: AppAuth): Express {
  return createHttpApp({
    // Same-origin in production and proxied by Vite in development, so no CORS is configured.
    cors: { origins: env.CORS_ORIGIN },
    // Registered after the gate, so it needs an identity like every other /api route.
    healthPath: "/api/health",
    // Any path under /api, mounted or not, answers 401 without an identity, and does so before
    // the body is parsed.
    gate: (app) => {
      app.use("/api", createAuthGate(auth.provider, { secureCookie: auth.secureCookie }));
    },
    mount: (app) => {
      app.use("/api", apiRoutes(services));
      // Any /api path no router answered: the JSON 404, not the SPA fallback below.
      app.use("/api", (_req, res) => {
        res.status(404).json({ error: "Not found" });
      });
      mountWeb(app);
    },
  });
}

/** Production only: in development the Vite server owns the page, not this process. */
function mountWeb(app: Express): void {
  if (env.NODE_ENV !== "production") return;
  const webDistPath = env.WEB_DIST_PATH ?? path.resolve(import.meta.dirname, "../../web/dist");
  if (!fs.existsSync(webDistPath)) {
    console.warn(`Web build not found at ${webDistPath}: serving the API only.`);
    return;
  }
  mountSpaHosting(app, { root: webDistPath, reservedPrefixes: ["/api"] });
  console.log(`Serving web build from ${webDistPath}`);
}
