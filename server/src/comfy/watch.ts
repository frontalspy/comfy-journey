import { ComfyError } from "./errors.js";
import type { ComfyEvent, ComfyHistoryEntry, WebSocketFactory } from "./types.js";

export interface WatchOptions {
  /** ws:// or wss:// URL including the clientId query. */
  url: string;
  promptId: string;
  createWebSocket: WebSocketFactory;
  /** Looked up once the socket opens, so a run that finished before we connected still ends. */
  history: () => Promise<ComfyHistoryEntry | null>;
  /** Max silence between frames before the watch fails with "timeout". */
  idleTimeoutMs: number;
  signal?: AbortSignal;
}

const TERMINAL: ReadonlySet<ComfyEvent["type"]> = new Set(["done", "error", "interrupted"]);

type Frame = { type?: unknown; data?: Record<string, unknown> };

function parseFrame(raw: unknown): Frame | undefined {
  if (typeof raw !== "string") return undefined; // binary frames are live previews
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? (parsed as Frame) : undefined;
  } catch {
    return undefined;
  }
}

/** Maps one frame to an event for `promptId`, or undefined when it is for another run or ignored. */
export function frameToEvent(frame: Frame, promptId: string): ComfyEvent | undefined {
  const data = frame.data ?? {};
  if (typeof data.prompt_id === "string" && data.prompt_id !== promptId) return undefined;
  switch (frame.type) {
    case "progress":
      if (typeof data.value !== "number" || typeof data.max !== "number") return undefined;
      return {
        type: "progress",
        value: data.value,
        max: data.max,
        nodeId: typeof data.node === "string" ? data.node : undefined,
      };
    case "executing":
      return typeof data.node === "string"
        ? { type: "executing", nodeId: data.node }
        : { type: "done" };
    case "executed":
      return typeof data.node === "string"
        ? {
            type: "executed",
            nodeId: data.node,
            output: (data.output as Record<string, unknown> | undefined) ?? {},
          }
        : undefined;
    case "execution_error": {
      const nodeId = typeof data.node_id === "string" ? data.node_id : undefined;
      // The raw exception text can carry paths and internals; the worker decides what users see.
      return { type: "error", message: `Execution failed in node ${nodeId ?? "?"}`, nodeId };
    }
    case "execution_interrupted":
      return { type: "interrupted" };
    default:
      return undefined;
  }
}

/** Typed async iterator over one prompt's websocket events. Ends after done, error or interrupted. */
export async function* watchPrompt(options: WatchOptions): AsyncGenerator<ComfyEvent> {
  const queue: ComfyEvent[] = [];
  let failure: ComfyError | undefined;
  let closed = false;
  let wake: (() => void) | undefined;
  const notify = (): void => wake?.();

  const socket = options.createWebSocket(options.url);
  socket.addEventListener("message", (event) => {
    const frame = parseFrame(event.data);
    const mapped = frame ? frameToEvent(frame, options.promptId) : undefined;
    if (mapped) queue.push(mapped);
    notify();
  });
  socket.addEventListener("close", () => {
    closed = true;
    notify();
  });
  socket.addEventListener("error", () => {
    failure ??= new ComfyError("unreachable", "Lost the connection to ComfyUI");
    notify();
  });
  socket.addEventListener("open", () => {
    options
      .history()
      .then((entry) => {
        if (!entry?.completed) return;
        queue.push(
          entry.statusStr === "error" ? { type: "error", message: "Run failed" } : { type: "done" },
        );
        notify();
      })
      .catch(() => undefined);
  });
  options.signal?.addEventListener("abort", notify);

  try {
    while (true) {
      const next = queue.shift();
      if (next) {
        yield next;
        if (TERMINAL.has(next.type)) return;
        continue;
      }
      if (failure) throw failure;
      if (closed) throw new ComfyError("unreachable", "ComfyUI closed the connection mid-run");
      if (options.signal?.aborted) return;
      let timer: ReturnType<typeof setTimeout> | undefined;
      await new Promise<void>((resolve) => {
        wake = resolve;
        timer = setTimeout(() => {
          failure ??= new ComfyError("timeout", "ComfyUI went silent");
          resolve();
        }, options.idleTimeoutMs);
      });
      clearTimeout(timer);
      wake = undefined;
    }
  } finally {
    options.signal?.removeEventListener("abort", notify);
    socket.close();
  }
}
