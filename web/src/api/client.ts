import type { ZodType, ZodTypeDef } from "zod";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function errorMessage(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (body && typeof body === "object" && "error" in body && typeof body.error === "string") {
      return body.error;
    }
  } catch {
    // Not JSON: fall through to the generic message.
  }
  return response.status === 401 ? "Sign in required." : `Request failed (${response.status}).`;
}

/** Low-level request helper. Feature code goes through `comfyApi`, never `fetch` directly. */
export async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (typeof init.body === "string") headers.set("Content-Type", "application/json");
  const response = await fetch(path, { ...init, headers, credentials: "same-origin" });
  if (!response.ok) throw new ApiError(response.status, await errorMessage(response));
  return response;
}

/** Fetches JSON and checks it against a schema: nothing from the network is trusted by shape. */
export async function requestJson<T>(
  path: string,
  schema: ZodType<T, ZodTypeDef, unknown>,
  init?: RequestInit,
): Promise<T> {
  const response = await request(path, init);
  const parsed = schema.safeParse(await response.json());
  if (!parsed.success) throw new ApiError(502, "The server sent an unexpected response.");
  return parsed.data;
}

export function jsonBody(value: unknown): RequestInit {
  return { body: JSON.stringify(value) };
}
