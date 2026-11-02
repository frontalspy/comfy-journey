import path from "node:path";
import { pathToFileURL } from "node:url";
import type { GpuGate } from "./gpuGate.js";
import { MemoryGpuGate } from "./memoryGpuGate.js";

/** What a GPU gate module default-exports: a factory for its gate. */
export type GpuGateFactory = () => GpuGate | Promise<GpuGate>;

/**
 * The gate that serialises jobs onto the GPU. By default an in-process first-come-first-served
 * gate; `GPU_GATE_MODULE` names a file whose default export builds another one, for sharing a
 * single GPU with software outside this app.
 */
export async function loadGpuGate(modulePath?: string): Promise<GpuGate> {
  if (!modulePath) return new MemoryGpuGate();
  const loaded = (await import(pathToFileURL(path.resolve(modulePath)).href)) as {
    default?: unknown;
  };
  if (typeof loaded.default !== "function") {
    throw new Error("GPU_GATE_MODULE must default-export a function that returns a GpuGate");
  }
  return await (loaded.default as GpuGateFactory)();
}
