import type { ComfyClient } from "../comfy/client.js";
import type { AppDatabase } from "../db/client.js";
import type { MediaStore } from "../storage/mediaStore.js";
import type { WorkflowRegistry } from "../workflows/registry.js";
import type { GpuGate } from "./gpuGate.js";
import type { JobEventBus } from "./jobEvents.js";

/** Everything the worker, runner and recovery share. Time and waiting are injected for tests. */
export interface JobContext {
  db: AppDatabase;
  comfy: ComfyClient;
  gate: GpuGate;
  store: MediaStore;
  registry: WorkflowRegistry;
  bus: JobEventBus;
  now(): Date;
  /** Resolves after `ms`, or early when `signal` aborts. Instant in tests. */
  delay(ms: number, signal?: AbortSignal): Promise<void>;
  /** Waits between retries after a transient failure; the last entry repeats for outages. */
  retryDelaysMs: readonly number[];
  log: Pick<Console, "warn" | "error">;
}
