import type { NextFunction, Request, Response } from "express";

/**
 * Headers that cost nothing and close off framing and sniffing. There is deliberately no
 * `img-src` restriction: with an S3-compatible store, pictures are served from the bucket's
 * address, which the app cannot know in advance.
 */
export function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader(
    "Content-Security-Policy",
    "frame-ancestors 'none'; base-uri 'self'; object-src 'none'",
  );
  next();
}
