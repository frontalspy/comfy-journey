/** A ComfyUI API-format graph: node id -> { class_type, inputs }. */
export interface ComfyNode {
  class_type: string;
  inputs: Record<string, unknown>;
  _meta?: { title?: string };
}
export type ComfyWorkflow = Record<string, ComfyNode>;

export interface ComfyFileRef {
  filename: string;
  subfolder: string;
  type: string;
}

export interface SubmitResult {
  promptId: string;
}

/** Typed events from the websocket, filtered to one prompt. The iterator ends after a terminal one. */
export type ComfyEvent =
  | { type: "progress"; value: number; max: number; nodeId?: string }
  | { type: "executing"; nodeId: string }
  | { type: "executed"; nodeId: string; output: Record<string, unknown> }
  | { type: "done" }
  | { type: "error"; message: string; nodeId?: string }
  | { type: "interrupted" };

export interface ComfyHistoryEntry {
  completed: boolean;
  /** "success" | "error" as ComfyUI reports it. */
  statusStr: string;
  outputs: Record<string, Record<string, unknown>>;
}

export interface FetchedOutput {
  bytes: Uint8Array;
  mime: string;
}

export interface FreeOptions {
  unloadModels: boolean;
  freeMemory: boolean;
}

/** The slice of /object_info the health check reads. */
export interface ComfyNodeInfo {
  input?: {
    required?: Record<string, unknown>;
    optional?: Record<string, unknown>;
  };
}
export type ComfyObjectInfo = Record<string, ComfyNodeInfo>;

export interface ComfySystemStats {
  system: Record<string, unknown>;
  devices: Record<string, unknown>[];
}

/** Counts the job_cleanup extension answers with; it never echoes paths. */
export interface CleanupResult {
  deleted: number;
  missing: number;
  refused: number;
}

export interface UploadedImage {
  name: string;
  subfolder: string;
  type: string;
}

/** The subset of the WebSocket API the client uses; Node's global WebSocket and `ws` both fit. */
export interface WebSocketLike {
  addEventListener(type: "open" | "close" | "error", listener: () => void): void;
  addEventListener(type: "message", listener: (event: { data?: unknown }) => void): void;
  close(): void;
}
export type WebSocketFactory = (url: string) => WebSocketLike;
