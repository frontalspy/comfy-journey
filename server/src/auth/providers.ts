import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { AuthIdentity, AuthProvider } from "./types.js";

/** The one user of a single-user install (`AUTH_MODE=none`). */
export const LOCAL_USER_ID = "local";

export const SESSION_COOKIE = "comfy_session";

/** Single-user mode: every request is the local user. Only allowed on a loopback address. */
export function createNoAuthProvider(): AuthProvider {
  return { name: "none", authenticate: () => ({ id: LOCAL_USER_ID }) };
}

function normaliseAddress(address: string | undefined): string {
  if (!address) return "";
  return address.startsWith("::ffff:") ? address.slice("::ffff:".length) : address;
}

export interface ProxyHeaderOptions {
  /** The header the proxy sets, lower case ("x-forwarded-user", "remote-user", ...). */
  header: string;
  /** Peer addresses the header is believed from. Anything else is ignored, so it cannot be forged. */
  trustedProxies: readonly string[];
}

/**
 * Identity from a header set by a reverse proxy that has already authenticated the user (Authelia,
 * oauth2-proxy, Tailscale serve, ...). The header is read only when the connection comes from a
 * trusted proxy address; from anyone else it is ignored, which is the whole defence against forging.
 */
export function createProxyHeaderProvider(options: ProxyHeaderOptions): AuthProvider {
  const trusted = new Set(options.trustedProxies.map(normaliseAddress));
  return {
    name: "proxy-header",
    authenticate(request: IncomingMessage): AuthIdentity | null {
      if (!trusted.has(normaliseAddress(request.socket.remoteAddress))) return null;
      const raw = request.headers[options.header];
      const value = (Array.isArray(raw) ? raw[0] : raw)?.trim();
      return value && value.length <= 256 ? { id: value } : null;
    },
  };
}

export interface TokenUser {
  id: string;
  secret: string;
}

/** `alice=secret1,bob=secret2` into users; throws on a malformed or duplicate entry. */
export function parseTokenUsers(source: string): TokenUser[] {
  const users: TokenUser[] = [];
  for (const entry of source.split(",")) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const at = trimmed.indexOf("=");
    const id = trimmed.slice(0, at).trim();
    const secret = trimmed.slice(at + 1).trim();
    if (at < 1 || !id || secret.length < 16) {
      throw new Error(
        "AUTH_TOKENS entries must look like id=secret with a secret of 16+ characters",
      );
    }
    if (users.some((user) => user.id === id)) throw new Error(`AUTH_TOKENS repeats the id "${id}"`);
    users.push({ id, secret });
  }
  if (users.length === 0) throw new Error("AUTH_TOKENS has no users");
  return users;
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function cookieValue(request: IncomingMessage, name: string): string | undefined {
  for (const part of (request.headers.cookie ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

function bearer(request: IncomingMessage): string | undefined {
  const header = request.headers.authorization;
  return header?.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : undefined;
}

/**
 * Shared-secret users: `Authorization: Bearer <secret>` for scripts, or the session cookie the
 * browser gets from `POST /api/auth/login`. The cookie holds the secret itself (opaque, HttpOnly),
 * so there is no session store to lose and revoking a user is removing their line from AUTH_TOKENS.
 */
export function createTokenProvider(users: readonly TokenUser[]): AuthProvider {
  const find = (secret: string | undefined): AuthIdentity | null => {
    if (!secret) return null;
    // Compare against every user so the time taken does not reveal which one matched.
    let found: AuthIdentity | null = null;
    for (const user of users) if (safeEqual(secret, user.secret)) found = { id: user.id };
    return found;
  };
  return {
    name: "token",
    authenticate: (request) => find(bearer(request) ?? cookieValue(request, SESSION_COOKIE)),
    session: {
      cookieName: SESSION_COOKIE,
      login: (credential) => (find(credential) ? credential : null),
    },
  };
}
