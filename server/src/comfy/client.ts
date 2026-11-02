import { randomUUID } from "node:crypto";
import { ComfyError } from "./errors.js";
import { isRecord } from "./guards.js";
import type {
  CleanupResult,
  ComfyEvent,
  ComfyFileRef,
  ComfyHistoryEntry,
  ComfyObjectInfo,
  ComfySystemStats,
  ComfyWorkflow,
  FetchedOutput,
  FreeOptions,
  SubmitResult,
  UploadedImage,
  WebSocketFactory,
  WebSocketLike,
} from "./types.js";
import { watchPrompt } from "./watch.js";

export interface ComfyClientOptions {
  baseUrl: string;
  fetch?: typeof fetch;
  createWebSocket?: WebSocketFactory;
  clientId?: string;
  /** Per HTTP request. Defaults to 30 s. */
  requestTimeoutMs?: number;
  /** Max silence on the websocket during a run. Defaults to 5 min (a model load can be slow). */
  idleTimeoutMs?: number;
  /** Shared secret for the job_cleanup extension; without it cleanup is off. */
  cleanupToken?: string;
  /** Per cleanup request. Defaults to 5 s. */
  cleanupTimeoutMs?: number;
}

export interface ComfyClient {
  submit(workflow: ComfyWorkflow): Promise<SubmitResult>;
  watch(promptId: string, signal?: AbortSignal): AsyncGenerator<ComfyEvent>;
  fetchOutput(ref: ComfyFileRef): Promise<FetchedOutput>;
  history(promptId: string): Promise<ComfyHistoryEntry | null>;
  interrupt(): Promise<void>;
  free(options: FreeOptions): Promise<void>;
  /** Whether a cleanup token is configured; callers skip cleanup entirely when false. */
  readonly cleanupEnabled: boolean;
  /**
   * Asks the job_cleanup extension to delete these files from ComfyUI's disk. Throws a
   * ComfyError (404 = extension not installed); callers treat every failure as non-fatal.
   */
  deleteOutputs(files: ComfyFileRef[]): Promise<CleanupResult>;
  objectInfo(): Promise<ComfyObjectInfo>;
  systemStats(): Promise<ComfySystemStats>;
  uploadImage(input: {
    bytes: Uint8Array;
    filename: string;
    mime?: string;
    /** ComfyUI input subfolder (created on demand); omitted for the input root. */
    subfolder?: string;
  }): Promise<UploadedImage>;
}

const defaultCreateWebSocket: WebSocketFactory = (url) => {
  const Ctor = (globalThis as { WebSocket?: new (url: string) => WebSocketLike }).WebSocket;
  if (!Ctor) throw new ComfyError("unreachable", "This Node.js has no global WebSocket");
  return new Ctor(url);
};

/** The extension refuses more than this many files per request. */
const CLEANUP_BATCH = 64;

const MAX_REJECTION_BYTES = 64 * 1024;

/**
 * A log-safe summary of a 400 from POST /prompt: which nodes ComfyUI refused and the error kind,
 * never the values it echoes back (those can include prompts and file names).
 */
async function describeRejection(res: Response): Promise<string> {
  try {
    const text = (await res.text()).slice(0, MAX_REJECTION_BYTES);
    const body: unknown = JSON.parse(text);
    if (!isRecord(body)) return "ComfyUI rejected the prompt";
    const parts: string[] = [];
    if (isRecord(body.error) && typeof body.error.type === "string") {
      parts.push(`error ${body.error.type.slice(0, 60)}`);
    }
    if (isRecord(body.node_errors)) {
      for (const [nodeId, detail] of Object.entries(body.node_errors).slice(0, 8)) {
        const errors = isRecord(detail) && Array.isArray(detail.errors) ? detail.errors : [];
        const kinds = errors
          .map((e) => (isRecord(e) && typeof e.type === "string" ? e.type.slice(0, 40) : "?"))
          .join(",");
        const cls =
          isRecord(detail) && typeof detail.class_type === "string" ? detail.class_type : "?";
        parts.push(`node ${nodeId.slice(0, 20)} (${cls.slice(0, 60)}): ${kinds}`);
      }
    }
    return `ComfyUI rejected the prompt${parts.length > 0 ? `: ${parts.join("; ")}` : ""}`;
  } catch {
    return "ComfyUI rejected the prompt";
  }
}

export function createComfyClient(options: ComfyClientOptions): ComfyClient {
  const base = options.baseUrl.replace(/\/+$/, "");
  const doFetch = options.fetch ?? fetch;
  const createWebSocket = options.createWebSocket ?? defaultCreateWebSocket;
  const clientId = options.clientId ?? randomUUID();
  const requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
  const idleTimeoutMs = options.idleTimeoutMs ?? 5 * 60_000;
  const cleanupToken = options.cleanupToken || undefined;
  const cleanupTimeoutMs = options.cleanupTimeoutMs ?? 5_000;

  async function request(
    path: string,
    init: RequestInit = {},
    timeoutMs: number = requestTimeoutMs,
  ): Promise<Response> {
    let res: Response;
    try {
      res = await doFetch(`${base}${path}`, {
        ...init,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      const name = err instanceof Error ? err.name : "";
      if (name === "TimeoutError" || name === "AbortError") {
        throw new ComfyError("timeout", `ComfyUI did not answer ${path} in time`, { cause: err });
      }
      throw new ComfyError("unreachable", "ComfyUI is unreachable", { cause: err });
    }
    if (!res.ok) {
      if (path === "/prompt" && res.status === 400) {
        throw new ComfyError("validation", await describeRejection(res), { status: 400 });
      }
      await res.body?.cancel().catch(() => undefined);
      throw new ComfyError("http", `ComfyUI answered ${res.status} for ${path}`, {
        status: res.status,
      });
    }
    return res;
  }

  async function json(path: string, init?: RequestInit): Promise<unknown> {
    const res = await request(path, init);
    try {
      return await res.json();
    } catch (err) {
      throw new ComfyError("http", `ComfyUI sent invalid JSON for ${path}`, {
        status: res.status,
        cause: err,
      });
    }
  }

  function post(path: string, body: unknown): Promise<Response> {
    return request(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  const history = async (promptId: string): Promise<ComfyHistoryEntry | null> => {
    const body = await json(`/history/${encodeURIComponent(promptId)}`);
    const entry = isRecord(body) ? body[promptId] : undefined;
    if (!isRecord(entry)) return null;
    const status = isRecord(entry.status) ? entry.status : {};
    const outputs: ComfyHistoryEntry["outputs"] = {};
    if (isRecord(entry.outputs)) {
      for (const [nodeId, output] of Object.entries(entry.outputs)) {
        if (isRecord(output)) outputs[nodeId] = output;
      }
    }
    return {
      completed: status.completed === true,
      statusStr: typeof status.status_str === "string" ? status.status_str : "unknown",
      outputs,
    };
  };

  return {
    async submit(workflow) {
      const body = await json("/prompt", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: workflow, client_id: clientId }),
      });
      if (!isRecord(body) || typeof body.prompt_id !== "string") {
        throw new ComfyError("http", "ComfyUI accepted the prompt without an id", { status: 200 });
      }
      return { promptId: body.prompt_id };
    },

    watch(promptId, signal) {
      const wsBase = base.replace(/^http/, "ws");
      return watchPrompt({
        url: `${wsBase}/ws?clientId=${encodeURIComponent(clientId)}`,
        promptId,
        createWebSocket,
        history: () => history(promptId),
        idleTimeoutMs,
        signal,
      });
    },

    async fetchOutput(ref) {
      const query = new URLSearchParams({
        filename: ref.filename,
        subfolder: ref.subfolder,
        type: ref.type,
      });
      const res = await request(`/view?${query.toString()}`);
      return {
        bytes: new Uint8Array(await res.arrayBuffer()),
        mime: res.headers.get("content-type") ?? "application/octet-stream",
      };
    },

    history,

    async interrupt() {
      await (await post("/interrupt", {})).body?.cancel();
    },

    async free({ unloadModels, freeMemory }) {
      await (
        await post("/free", { unload_models: unloadModels, free_memory: freeMemory })
      ).body?.cancel();
    },

    cleanupEnabled: cleanupToken !== undefined,

    async deleteOutputs(files) {
      const total: CleanupResult = { deleted: 0, missing: 0, refused: 0 };
      if (!cleanupToken) return total;
      for (let start = 0; start < files.length; start += CLEANUP_BATCH) {
        const res = await request(
          "/job-cleanup",
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${cleanupToken}`,
            },
            body: JSON.stringify({ files: files.slice(start, start + CLEANUP_BATCH) }),
          },
          cleanupTimeoutMs,
        );
        const body: unknown = await res.json().catch(() => undefined);
        for (const key of ["deleted", "missing", "refused"] as const) {
          const count = isRecord(body) ? body[key] : undefined;
          if (typeof count === "number" && Number.isFinite(count)) total[key] += count;
        }
      }
      return total;
    },

    async objectInfo() {
      const body = await json("/object_info");
      if (!isRecord(body)) throw new ComfyError("http", "ComfyUI sent an invalid /object_info");
      return body as ComfyObjectInfo;
    },

    async systemStats() {
      const body = await json("/system_stats");
      if (!isRecord(body)) throw new ComfyError("http", "ComfyUI sent invalid /system_stats");
      return {
        system: isRecord(body.system) ? body.system : {},
        devices: Array.isArray(body.devices) ? body.devices.filter(isRecord) : [],
      };
    },

    async uploadImage({ bytes, filename, mime, subfolder }) {
      const form = new FormData();
      form.append("image", new Blob([bytes], { type: mime ?? "image/png" }), filename);
      if (subfolder) form.append("subfolder", subfolder);
      form.append("type", "input");
      form.append("overwrite", "true");
      const body = await json("/upload/image", { method: "POST", body: form });
      if (!isRecord(body) || typeof body.name !== "string") {
        throw new ComfyError("http", "ComfyUI sent an invalid upload response");
      }
      return {
        name: body.name,
        subfolder: typeof body.subfolder === "string" ? body.subfolder : "",
        type: typeof body.type === "string" ? body.type : "input",
      };
    },
  };
}

export { collectOutputFiles, MAX_OUTPUTS_PER_JOB } from "./collectOutputs.js";
