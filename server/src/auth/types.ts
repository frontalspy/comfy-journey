import type { IncomingMessage } from "node:http";

/** Who is calling. The id is an opaque string: it scopes every row a user owns. */
export interface AuthIdentity {
  id: string;
}

/**
 * Decides who a request is from. An implementation returns `null` for anything it does not
 * accept (no credential, a wrong one, an expired one) and never says which: the caller always
 * answers the same 401.
 */
export interface AuthProvider {
  /** A short name for logs. */
  readonly name: string;
  authenticate(request: IncomingMessage): Promise<AuthIdentity | null> | AuthIdentity | null;
  /**
   * Optional: lets a provider that owns a session (the token mode's cookie) answer
   * `POST /api/auth/login` and `POST /api/auth/logout`. Absent for providers that identify a
   * request by itself, such as a trusted proxy header.
   */
  session?: AuthSession;
}

export interface AuthSession {
  /** Returns the cookie value to set for a valid credential, or null for an invalid one. */
  login(credential: string): Promise<string | null> | string | null;
  /** The name of the cookie the provider reads. */
  readonly cookieName: string;
}

/** What a plug-in module (AUTH_MODULE) default-exports: a factory for its provider. */
export type AuthProviderFactory = () => AuthProvider | Promise<AuthProvider>;
