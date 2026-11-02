import { describe, expect, it, vi } from "vitest";
import { runBackupCli } from "./runBackupCli.js";

describe("runBackupCli", () => {
  it("logs the snapshot path and exits 0", async () => {
    const exit = vi.fn();
    const log = { log: vi.fn(), error: vi.fn() };
    await runBackupCli({ run: async () => "/backups/svc-1.sqlite" }, { exit, log });
    expect(log.log).toHaveBeenCalledWith("Backup written to /backups/svc-1.sqlite");
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("logs the failure and exits 1", async () => {
    const exit = vi.fn();
    const log = { log: vi.fn(), error: vi.fn() };
    const failure = new Error("disk full");
    await runBackupCli(
      {
        run: async () => {
          throw failure;
        },
      },
      { exit, log },
    );
    expect(log.error).toHaveBeenCalledWith(failure);
    expect(exit).toHaveBeenCalledWith(1);
  });
});
