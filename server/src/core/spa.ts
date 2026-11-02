import path from "node:path";
import express, { type Express } from "express";

export interface SpaHostingOptions {
  /** Absolute path to the built SPA (its Vite `dist/`). */
  root: string;
  /**
   * URL prefixes that belong to something else (e.g. `/api`): a request under one that no earlier
   * handler answered is a plain 404, never the SPA shell.
   */
  reservedPrefixes?: readonly string[];
}

/**
 * The SPA half of the server: cache headers (hashed assets immutable for a year, index.html
 * `no-cache`, other files an hour) and the history-API fallback. Mounts nothing that
 * authenticates: callers put it behind whatever gate they need.
 */
export function mountSpaHosting(app: Express, options: SpaHostingOptions): void {
  const root = path.resolve(options.root);
  const reserved = options.reservedPrefixes ?? [];
  const isReserved = (requestPath: string): boolean =>
    reserved.some((prefix) => requestPath === prefix || requestPath.startsWith(`${prefix}/`));

  // Hashed assets are immutable by construction: the content hash is in the filename, so a
  // changed file is a changed URL and can be cached for a year.
  app.use(
    "/assets",
    express.static(path.join(root, "assets"), { immutable: true, maxAge: "1y", fallthrough: true }),
  );

  // Everything else (favicons, the odd static file) gets a short cache and no fallback to
  // index.html for files that genuinely do not exist.
  app.use(
    express.static(root, {
      index: false,
      maxAge: "1h",
      // The shell references the hashed assets, so a stale copy would point at deleted files.
      setHeaders: (res, filePath) => {
        if (path.basename(filePath) === "index.html") res.set("Cache-Control", "no-cache");
      },
    }),
  );

  // History-API fallback. Anything that is not a real file is a client route, except paths that
  // can only mean a file (under /assets, or with an extension): answering those with index.html
  // and a 200 would hide a broken deploy as a blank page.
  app.get("/{*splat}", (req, res, next) => {
    if (
      req.path === "/assets" ||
      req.path.startsWith("/assets/") ||
      isReserved(req.path) ||
      path.extname(req.path)
    ) {
      next();
      return;
    }
    res.set("Cache-Control", "no-cache");
    res.sendFile(path.join(root, "index.html"));
  });
}
