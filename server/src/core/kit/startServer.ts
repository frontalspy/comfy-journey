import { createServer, type RequestListener, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { BackupService } from "./backup.js";

export interface StartServerOptions {
  /** An Express app (or any Node request listener). */
  app: RequestListener;
  /** Used in log lines, e.g. "comfy". */
  name: string;
  port: number;
  /** Defaults to loopback, so a new install is private. */
  host?: string;
  /** Started after listening when `runScheduler` is true (a service's RUN_BACKUP_SCHEDULER). */
  backup?: { service: Pick<BackupService, "startScheduler">; runScheduler: boolean };
  /** Cleanup after the server stops accepting connections, e.g. closing the db client. */
  onShutdown?: () => void | Promise<void>;
  /** Install SIGINT/SIGTERM handlers that shut down gracefully and exit. Default true. */
  handleSignals?: boolean;
  log?: Pick<Console, "log" | "warn" | "error">;
}

export interface RunningServer {
  server: Server;
  /** Resolves once listening, with the bound port (useful when `port` is 0). */
  ready: Promise<number>;
  /** Stops the backup schedule, closes the server, then runs `onShutdown`. Idempotent. */
  shutdown(): Promise<void>;
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);
const FORCE_EXIT_AFTER_MS = 10_000;

/**
 * Binds the app, warns when bound off loopback (whatever authenticates requests must be the only way in), starts the backup schedule if enabled, and shuts
 * down gracefully on SIGINT/SIGTERM.
 */
export function startServer(options: StartServerOptions): RunningServer {
  const log = options.log ?? console;
  const host = options.host ?? "127.0.0.1";
  const server = createServer(options.app);
  let stopBackups: (() => void) | undefined;
  let shuttingDown: Promise<void> | undefined;

  const ready = new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, host, () => {
      const { port } = server.address() as AddressInfo;
      log.log(`${options.name} listening on http://${host}:${port}`);
      if (!LOOPBACK_HOSTS.has(host)) {
        log.warn(
          `Bound to ${host}: make sure only trusted clients can reach this port, and that AUTH_MODE is not none.`,
        );
      }
      if (options.backup?.runScheduler) stopBackups = options.backup.service.startScheduler();
      resolve(port);
    });
  });

  function shutdown(): Promise<void> {
    shuttingDown ??= (async () => {
      stopBackups?.();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await options.onShutdown?.();
    })();
    return shuttingDown;
  }

  if (options.handleSignals !== false) {
    const onSignal = (signal: NodeJS.Signals): void => {
      log.log(`${options.name} received ${signal}, shutting down`);
      setTimeout(() => process.exit(1), FORCE_EXIT_AFTER_MS).unref();
      shutdown()
        .then(() => process.exit(0))
        .catch((err) => {
          log.error("Shutdown failed:", err);
          process.exit(1);
        });
    };
    process.once("SIGINT", onSignal);
    process.once("SIGTERM", onSignal);
  }

  return { server, ready, shutdown };
}
