import type { Request } from "express";
import { UnauthorizedError } from "../core/kit/index.js";

/** The verified Access identity the gate attached. Absent only if a route escaped the gate. */
export function ownerOf(req: Request): string {
  if (!req.ownerId) throw new UnauthorizedError("Authentication required");
  return req.ownerId;
}

/** A route parameter. Typed loosely because validateBody widens `req.params`. */
export function paramOf(req: Request, name: string): string {
  const value = (req.params as Record<string, string | undefined>)[name];
  return value ?? "";
}
