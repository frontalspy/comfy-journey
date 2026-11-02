import cors from "cors";
import express, { type Express } from "express";
import { type ErrorHandlerOptions, errorHandler } from "./errorHandler.js";

export interface HttpAppCorsOptions {
  /**
   * Comma-separated list of allowed origins (a service's CORS_ORIGIN). Always sent with
   * `credentials: true` — the Access cookie has to travel on cross-origin calls, and a wildcard
   * origin can't be combined with credentials per the fetch spec.
   */
  origins?: string;
  /**
   * When no `origins` are configured, reflect whatever origin asked. For local dev only, where
   * apps run on different localhost ports with no configuration; never enable it in production.
   */
  reflectAnyOrigin?: boolean;
}

export interface HttpAppOptions {
  cors?: HttpAppCorsOptions;
  /** JSON body size limit. Defaults to Express's own default (100kb). */
  jsonLimit?: string;
  /**
   * When set, a `GET <healthPath>` answering `{ status: "ok" }`. It is registered AFTER the
   * gate, so behind a gate it needs the same verified identity as every other route: there is
   * no unauthenticated endpoint. (With no gate configured it is open, as in a bare test app.)
   */
  healthPath?: string;
  /**
   * Registers middleware that must run BEFORE the body is parsed — the authentication gate.
   * It sits after CORS (so preflights are answered without credentials) and ahead of the health
   * route and `express.json`, so an unauthenticated request with a malformed or oversized body
   * gets the gate's 401 rather than a 400 or 413.
   */
  gate?: (app: Express) => void;
  /** Registers the service's own middleware and routes, after the gate, body parsing and health. */
  mount: (app: Express) => void;
  errorHandler?: ErrorHandlerOptions;
}

function corsMiddleware(options: HttpAppCorsOptions | undefined) {
  if (options?.origins) {
    const origin = options.origins
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
    return cors({ origin, credentials: true });
  }
  if (options?.reflectAnyOrigin) return cors({ origin: true, credentials: true });
  return undefined;
}

/**
 * The Express app every API starts from: CORS, the caller's pre-body `gate`, an optional
 * (gated) health route, JSON body parsing, the caller's routes, and the terminal `errorHandler` — always last, so no route can be
 * registered after it and escape the shared error body.
 */
export function createHttpApp(options: HttpAppOptions): Express {
  const app = express();

  const corsHandler = corsMiddleware(options.cors);
  if (corsHandler) app.use(corsHandler);

  options.gate?.(app);

  if (options.healthPath) {
    app.get(options.healthPath, (_req, res) => {
      res.json({ status: "ok" });
    });
  }

  app.use(express.json(options.jsonLimit ? { limit: options.jsonLimit } : undefined));

  options.mount(app);
  app.use(errorHandler(options.errorHandler));
  return app;
}
