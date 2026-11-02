import type { JobEvent } from "@comfy/shared";

type Listener = (event: JobEvent) => void;

/** In-memory per-job fan-out for SSE. The job row stays the source of truth. */
export class JobEventBus {
  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly everything = new Set<Listener>();

  subscribe(jobId: string, listener: Listener): () => void {
    let set = this.listeners.get(jobId);
    if (!set) {
      set = new Set();
      this.listeners.set(jobId, set);
    }
    set.add(listener);
    return () => {
      set.delete(listener);
      if (set.size === 0) this.listeners.delete(jobId);
    };
  }

  /** Every event for every job; the caller filters by ownership. */
  subscribeAll(listener: Listener): () => void {
    this.everything.add(listener);
    return () => {
      this.everything.delete(listener);
    };
  }

  publish(event: JobEvent): void {
    for (const listener of [...this.everything]) listener(event);
    for (const listener of [...(this.listeners.get(event.jobId) ?? [])]) listener(event);
  }
}
