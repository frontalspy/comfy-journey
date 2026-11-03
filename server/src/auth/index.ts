import path from "node:path";
import { pathToFileURL } from "node:url";
import express, { type NextFunction, type Request, type Response } from "express";
import { UnauthorizedError } from "../core/kit/index.js";
import { OwnerRateLimiter } from "../jobs/rateLimiter.js";
import {
  createNoAuthProvider,
  createProxyHeaderProvider,
  createTokenProvider,
  parseTokenUsers,
} from "./providers.js";
import type { AuthProvider, AuthProviderFactory } from "./types.js";

export * from "./providers.js";
export type * from "./types.js";

export const AUTH_MODES = ["none", "proxy-header", "token", "module"] as const;
export type AuthMode = (typeof AUTH_MODES)[number];

export interface AuthSettings {
  mode: AuthMode;
  /** The address the server listens on; `none` is only allowed on a loopback one. */
  host: string;
  /** Lets `none` listen on a non-loopback address (a container whose port is published to loopback). */
  allowNoAuthOnNetwork: boolean;
  /** `proxy-header` mode. */
  header: string;
  trustedProxies: readonly string[];
  /** `token` mode: `id=secret,id2=secret2`. */
  tokens?: string;
  /** `module` mode: a file whose default export is an `AuthProviderFactory`. */
  module?: string;
}

const LOGIN_ATTEMPTS = { hits: 10, windowMs: 60_000 } as const;

const LOOPBACK = new Set(["127.0.0.1", "::1", "localhost"]);

export function isLoopbackHost(host: string): boolean {
  return LOOPBACK.has(host) || host.startsWith("127.");
}

declare global {
  namespace Express {
    interface Request {
      /** Set by the auth gate on every authenticated request. */
      ownerId?: string;
    }
  }
}

/**
 * Builds the configured provider, or throws with a plain reason. Every failure is at boot and
 * every default is closed: a missing secret, an unreadable module or `none` on a network address
 * stops the server instead of leaving it open.
 */
export async function createAuthProvider(settings: AuthSettings): Promise<AuthProvider> {
  switch (settings.mode) {
    case "none":
      if (!isLoopbackHost(settings.host) && !settings.allowNoAuthOnNetwork) {
        throw new Error(
          `AUTH_MODE=none is only allowed on a loopback address, and HOST is "${settings.host}". ` +
            "Choose another AUTH_MODE, bind to 127.0.0.1, or set AUTH_NONE_ALLOW_NETWORK=true " +
            "if something in front of the server already restricts who can reach it.",
        );
      }
      return createNoAuthProvider();
    case "proxy-header":
      return createProxyHeaderProvider({
        header: settings.header,
        trustedProxies: settings.trustedProxies,
      });
    case "token":
      if (!settings.tokens) throw new Error("AUTH_MODE=token needs AUTH_TOKENS");
      return createTokenProvider(parseTokenUsers(settings.tokens));
    case "module": {
      if (!settings.module) throw new Error("AUTH_MODE=module needs AUTH_MODULE");
      const loaded = (await import(pathToFileURL(path.resolve(settings.module)).href)) as {
        default?: unknown;
      };
      if (typeof loaded.default !== "function") {
        throw new Error("AUTH_MODULE must default-export a function that returns an AuthProvider");
      }
      return await (loaded.default as AuthProviderFactory)();
    }
  }
}

function deny(next: NextFunction): void {
  next(new UnauthorizedError("Authentication required"));
}

/**
 * The gate every `/api` request passes first: a verified identity becomes `req.ownerId`, anything
 * else is the same 401 with `Cache-Control: no-store`. A provider that owns a session also gets
 * `POST /api/auth/login` and `/api/auth/logout`, the only two paths reachable without an identity.
 */
export function createAuthGate(
  provider: AuthProvider,
  options: { secureCookie: boolean },
): (req: Request, res: Response, next: NextFunction) => void {
  // Sign-in attempts per peer address. Tokens are long, so this only slows guessing down.
  const loginAttempts = new OwnerRateLimiter(LOGIN_ATTEMPTS.hits, LOGIN_ATTEMPTS.windowMs);
  return (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    const { session } = provider;
    if (session && req.method === "POST" && req.path === "/auth/login") {
      if (!loginAttempts.tryHit(req.socket.remoteAddress ?? "unknown")) {
        res.status(429).json({ error: "Too many sign-in attempts. Try again in a minute." });
        return;
      }
      // The one body this gate reads itself: small, JSON only, and before any identity exists.
      express.json({ limit: "2kb" })(req, res, (err?: unknown) => {
        if (err) return deny(next);
        handleLogin(provider, options.secureCookie, req, res, next);
      });
      return;
    }
    if (session && req.method === "POST" && req.path === "/auth/logout") {
      res.clearCookie(session.cookieName, { path: "/" });
      res.status(204).end();
      return;
    }
    Promise.resolve(provider.authenticate(req))
      .then((identity) => {
        if (!identity) return deny(next);
        req.ownerId = identity.id;
        next();
      })
      .catch((err: unknown) => {
        console.warn(
          `[auth] ${provider.name} failed: ${err instanceof Error ? err.message : "unknown"}`,
        );
        deny(next);
      });
  };
}

function handleLogin(
  provider: AuthProvider,
  secure: boolean,
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const session = provider.session;
  const body = req.body as { token?: unknown } | undefined;
  const credential = typeof body?.token === "string" ? body.token : "";
  Promise.resolve(session?.login(credential))
    .then((value) => {
      if (!session || !value) return deny(next);
      res.cookie(session.cookieName, value, {
        httpOnly: true,
        sameSite: "lax",
        secure,
        path: "/",
        maxAge: 30 * 24 * 60 * 60 * 1000,
      });
      res.status(204).end();
    })
    .catch(() => deny(next));
}
