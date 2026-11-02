import { describe, expect, it } from "vitest";
import { GpuWaitAbortedError } from "./gpuGate.js";
import { MemoryGpuGate } from "./memoryGpuGate.js";

describe("MemoryGpuGate", () => {
  it("serves holders strictly first come, first served", async () => {
    const gate = new MemoryGpuGate();
    const order: string[] = [];
    const first = await gate.acquire({ label: "a" });
    const second = gate.acquire({ label: "b" }).then((lease) => {
      order.push("b");
      return lease;
    });
    const third = gate.acquireAs("other-app", { label: "c" }).then((lease) => {
      order.push("c");
      return lease;
    });
    expect(await gate.status()).toEqual([
      { app: "comfy", position: 0 },
      { app: "comfy", position: 1 },
      { app: "other-app", position: 2 },
    ]);
    await first.release();
    (await second).release();
    (await third).release();
    expect(order).toEqual(["b", "c"]);
    expect(await gate.status()).toEqual([]);
  });

  it("drops a waiter whose signal aborts, keeping everyone else's place", async () => {
    const gate = new MemoryGpuGate();
    const holder = await gate.acquire({ label: "a" });
    const controller = new AbortController();
    const aborted = gate.acquire({ label: "b", signal: controller.signal });
    const next = gate.acquire({ label: "c" });
    controller.abort();
    await expect(aborted).rejects.toBeInstanceOf(GpuWaitAbortedError);
    expect(await gate.status()).toHaveLength(2);
    holder.release();
    (await next).release();
  });

  it("rejects at once when the signal is already aborted, and release is idempotent", async () => {
    const gate = new MemoryGpuGate();
    const controller = new AbortController();
    controller.abort();
    await expect(gate.acquire({ label: "x", signal: controller.signal })).rejects.toBeInstanceOf(
      GpuWaitAbortedError,
    );
    const lease = await gate.acquire({ label: "y" });
    lease.release();
    lease.release();
    const again = await gate.acquire({ label: "z" });
    again.release();
  });
});
