/** Names an application that holds or waits for the GPU (this app, or a neighbour sharing it). */
export type GpuApp = string;

/** Held while a job uses the GPU. `release` is idempotent. */
export interface GpuLeaseHandle {
  release(): void | Promise<void>;
}

/** One waiter or holder of the GPU. Position 0 holds it; never carries a user or a job. */
export interface GpuQueueEntry {
  app: GpuApp;
  position: number;
}

export interface GpuAcquireOptions {
  /** A short label for operators; never shown to other users. */
  label: string;
  /** Aborting while waiting rejects the acquire and drops the place in line. */
  signal?: AbortSignal;
}

/**
 * Strict first-come-first-served mutual exclusion on the GPU. The worker only knows this
 * interface; the in-memory gate serves a single install and tests, and a plug-in module can
 * share the GPU with other software (see loadGpuGate).
 */
export interface GpuGate {
  acquire(options: GpuAcquireOptions): Promise<GpuLeaseHandle>;
  status(): Promise<GpuQueueEntry[]>;
}

export class GpuWaitAbortedError extends Error {
  constructor() {
    super("Stopped waiting for the GPU");
    this.name = "GpuWaitAbortedError";
  }
}
