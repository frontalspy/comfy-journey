import { describe, expect, it, vi } from "vitest";
import { createHttpApp } from "./httpApp.js";
import { startServer } from "./startServer.js";

function quietLog() {
  return { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

const app = createHttpApp({ healthPath: "/api/health", mount: () => {} });

describe("startServer", () => {
  it("listens, serves, and shuts down cleanly, running onShutdown once", async () => {
    const onShutdown = vi.fn();
    const log = quietLog();
    const running = startServer({
      app,
      name: "test-api",
      port: 0,
      onShutdown,
      handleSignals: false,
      log,
    });
    const port = await running.ready;

    const res = await fetch(`http://127.0.0.1:${port}/api/health`);
    expect(await res.json()).toEqual({ status: "ok" });
    expect(log.log).toHaveBeenCalledWith(`test-api listening on http://127.0.0.1:${port}`);
    expect(log.warn).not.toHaveBeenCalled();

    await Promise.all([running.shutdown(), running.shutdown()]);
    expect(onShutdown).toHaveBeenCalledOnce();
    expect(running.server.listening).toBe(false);
  });

  it("starts and stops the backup schedule only when enabled", async () => {
    const stop = vi.fn();
    const startScheduler = vi.fn(() => stop);

    const disabled = startServer({
      app,
      name: "a",
      port: 0,
      handleSignals: false,
      log: quietLog(),
      backup: { service: { startScheduler }, runScheduler: false },
    });
    await disabled.ready;
    await disabled.shutdown();
    expect(startScheduler).not.toHaveBeenCalled();

    const enabled = startServer({
      app,
      name: "b",
      port: 0,
      handleSignals: false,
      log: quietLog(),
      backup: { service: { startScheduler }, runScheduler: true },
    });
    await enabled.ready;
    expect(startScheduler).toHaveBeenCalledOnce();
    await enabled.shutdown();
    expect(stop).toHaveBeenCalledOnce();
  });

  it("warns when bound off loopback", async () => {
    const log = quietLog();
    const running = startServer({
      app,
      name: "c",
      port: 0,
      host: "0.0.0.0",
      handleSignals: false,
      log,
    });
    await running.ready;
    expect(log.warn).toHaveBeenCalledOnce();
    await running.shutdown();
  });
});
