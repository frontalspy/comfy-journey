export type ComfyErrorKind = "unreachable" | "timeout" | "http" | "validation" | "execution";

/** Mirrors LlmError. Messages are safe to log; they never carry ComfyUI payloads or file paths. */
export class ComfyError extends Error {
  readonly kind: ComfyErrorKind;
  /** HTTP status, set when `kind` is "http" or "validation". */
  readonly status?: number;
  /** The node that failed, set when `kind` is "execution". */
  readonly nodeId?: string;

  constructor(
    kind: ComfyErrorKind,
    message: string,
    options?: { status?: number; nodeId?: string; cause?: unknown },
  ) {
    super(message, { cause: options?.cause });
    this.name = "ComfyError";
    this.kind = kind;
    this.status = options?.status;
    this.nodeId = options?.nodeId;
  }
}

/**
 * Whether a failure is worth retrying later: the server could not be reached, timed out or
 * answered 5xx. Execution errors, validation errors and 4xx (a rejected graph) are permanent.
 */
export function isTransient(err: unknown): boolean {
  if (!(err instanceof ComfyError)) return false;
  if (err.kind === "unreachable" || err.kind === "timeout") return true;
  return err.kind === "http" && (err.status ?? 0) >= 500;
}
