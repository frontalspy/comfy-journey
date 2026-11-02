import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { z } from "zod";
import { BadRequestError } from "./errors.js";
import { zodErrorMessage, zodIssueMessages } from "./zodMessages.js";

/**
 * Parses `value` with `schema`, throwing a BadRequestError (the shared 400 body) on failure.
 *
 * For routes that must validate AFTER an existence or ownership check — a 404 for something the
 * caller can't see has to win over a 400 for their body, or the 400 leaks that it exists. Routes
 * with no such ordering constraint use `validateBody` instead.
 *
 * `undefined` is parsed as `{}`: Express 5 leaves `req.body` undefined when no body was sent,
 * where Express 4 gave `{}`, and an all-optional schema must keep accepting an empty request.
 */
export function parseBody<S extends z.ZodTypeAny>(schema: S, value: unknown): z.infer<S> {
  const parsed = schema.safeParse(value ?? {});
  if (!parsed.success) {
    throw new BadRequestError(zodErrorMessage(parsed.error), zodIssueMessages(parsed.error));
  }
  return parsed.data;
}

/**
 * Middleware form of `parseBody`: validates `req.body` and replaces it with the parsed value
 * (so zod transforms such as `.trim().toLowerCase()` reach the handler). Failures go to
 * `errorHandler` as the shared 400 body.
 *
 * Mounted before a handler, it widens that handler's `req.params` to Express's generic
 * dictionary, so read route params as `req.params.id as string` there.
 */
export function validateBody(schema: z.ZodTypeAny): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    req.body = parseBody(schema, req.body);
    next();
  };
}
