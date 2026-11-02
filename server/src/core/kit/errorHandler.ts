import { STATUS_CODES } from "node:http";
import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import { HttpError } from "./errors.js";
import { zodErrorMessage, zodIssueMessages } from "./zodMessages.js";

/** The single error body both APIs send. */
export interface ErrorBody {
  error: string;
  issues?: string[];
}

export interface ErrorHandlerOptions {
  /** Where unexpected (500) errors are logged. Defaults to console.error. */
  log?: (message: string, error: unknown) => void;
}

/** body-parser's own errors carry a `type` and an HTTP status; map the two a client can cause. */
function bodyParserError(err: unknown): { status: number; body: ErrorBody } | undefined {
  if (typeof err !== "object" || err === null || !("type" in err)) return undefined;
  if (err.type === "entity.parse.failed") {
    return { status: 400, body: { error: "Malformed JSON body." } };
  }
  if (err.type === "entity.too.large") {
    return { status: 413, body: { error: "Request body too large." } };
  }
  return undefined;
}

/**
 * Express, its router and body-parser flag errors a client caused (a malformed URI param, an
 * unsupported charset...) with a 4xx `status`. http-errors adds `expose: true`; the router's
 * bad-URI error sets only `status`, so only an explicit `expose: false` opts out. Answer with that
 * status and a generic message; the error's own text is never echoed.
 */
function exposedClientError(err: unknown): { status: number; body: ErrorBody } | undefined {
  if (typeof err !== "object" || err === null) return undefined;
  const candidate = err as { status?: unknown; statusCode?: unknown; expose?: unknown };
  if (candidate.expose === false) return undefined;
  const status = candidate.status ?? candidate.statusCode;
  if (typeof status !== "number" || status < 400 || status > 499) return undefined;
  return { status, body: { error: STATUS_CODES[status] ?? "Bad request" } };
}

function toResponse(err: unknown): { status: number; body: ErrorBody } | undefined {
  if (err instanceof HttpError) {
    const body: ErrorBody = { error: err.message };
    if (err.issues) body.issues = err.issues;
    return { status: err.status, body };
  }
  if (err instanceof ZodError) {
    return { status: 400, body: { error: zodErrorMessage(err), issues: zodIssueMessages(err) } };
  }
  return bodyParserError(err) ?? exposedClientError(err);
}

/**
 * Terminal error middleware — register it last. Known errors become their status and the shared
 * body; anything else is logged server-side and answered with a generic 500 that never leaks the
 * underlying message or stack.
 */
export function errorHandler(options: ErrorHandlerOptions = {}): ErrorRequestHandler {
  const log = options.log ?? ((message, error) => console.error(message, error));

  return (err, req, res, next) => {
    if (res.headersSent) {
      next(err);
      return;
    }
    const known = toResponse(err);
    if (known) {
      res.status(known.status).json(known.body);
      return;
    }
    log(`Unhandled error on ${req.method} ${req.originalUrl}:`, err);
    res.status(500).json({ error: "Internal server error" } satisfies ErrorBody);
  };
}
