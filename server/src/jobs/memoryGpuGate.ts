import {
  type GpuAcquireOptions,
  type GpuApp,
  type GpuGate,
  type GpuLeaseHandle,
  type GpuQueueEntry,
  GpuWaitAbortedError,
} from "./gpuGate.js";

interface Waiter {
  app: GpuApp;
  grant: () => void;
  reject: (error: Error) => void;
}

/** In-process FIFO gate: one holder at a time, waiters served in arrival order. */
export class MemoryGpuGate implements GpuGate {
  private holder: { app: GpuApp } | undefined;
  private readonly waiters: Waiter[] = [];

  constructor(private readonly app: GpuApp = "comfy") {}

  acquire(options: GpuAcquireOptions): Promise<GpuLeaseHandle> {
    return this.acquireAs(this.app, options);
  }

  /** Lets a test stand in for another GPU user. */
  acquireAs(app: GpuApp, options: GpuAcquireOptions): Promise<GpuLeaseHandle> {
    const { signal } = options;
    if (signal?.aborted) return Promise.reject(new GpuWaitAbortedError());
    return new Promise<GpuLeaseHandle>((resolve, reject) => {
      const holderRecord = { app };
      const lease = (): GpuLeaseHandle => {
        let released = false;
        return {
          release: () => {
            if (released) return;
            released = true;
            this.holder = undefined;
            this.grantNext();
          },
        };
      };
      const waiter: Waiter = {
        app,
        grant: () => {
          signal?.removeEventListener("abort", onAbort);
          this.holder = holderRecord;
          resolve(lease());
        },
        reject,
      };
      const onAbort = (): void => {
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) this.waiters.splice(index, 1);
        reject(new GpuWaitAbortedError());
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      this.waiters.push(waiter);
      if (!this.holder) this.grantNext();
    });
  }

  async status(): Promise<GpuQueueEntry[]> {
    const entries: GpuQueueEntry[] = [];
    if (this.holder) entries.push({ app: this.holder.app, position: 0 });
    for (const [index, waiter] of this.waiters.entries()) {
      entries.push({ app: waiter.app, position: index + (this.holder ? 1 : 0) });
    }
    return entries;
  }

  private grantNext(): void {
    if (this.holder) return;
    this.waiters.shift()?.grant();
  }
}
