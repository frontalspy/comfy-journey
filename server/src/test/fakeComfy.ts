import http from "node:http";
import type { AddressInfo } from "node:net";
import { type WebSocket, WebSocketServer } from "ws";

type FakeCleanupFile = { filename: string; subfolder: string; type: string };

export type FakeFrame = { type: string; data: Record<string, unknown> };

export interface FakeComfy {
  /** http://127.0.0.1:<port> */
  url: string;
  submitted: unknown[];
  frees: unknown[];
  interrupts: number;
  uploads: string[];
  /** The file name and subfolder of every /upload/image, as the multipart form declared them. */
  uploadMeta: { filename: string; subfolder: string }[];
  /** Every /view request, so a test can prove the right `type` was asked for. */
  views: { filename: string; subfolder: string; type: string }[];
  /** Answer the next POST /prompt with a 400 carrying this body (ComfyUI's validation error). */
  rejectNextPrompt: unknown;
  /** Outputs served by /view, keyed by filename. */
  files: Map<string, { mime: string; bytes: Buffer }>;
  history: Map<string, unknown>;
  objectInfo: Record<string, unknown>;
  /** Frames to push once the prompt is submitted AND a websocket is connected. */
  runScript: (promptId: string) => FakeFrame[];
  /** Close the websocket after the frames are sent (a disconnect mid-run). */
  disconnectAfterScript: boolean;
  /** The job_cleanup extension: the bearer token it accepts (undefined = route disabled, 503). */
  cleanupToken: string | undefined;
  /** False answers 404 like a ComfyUI without the extension installed. */
  cleanupRoute: boolean;
  /** Answer every cleanup request with this status instead of handling it. */
  cleanupFailWith: number | undefined;
  /** Never answer cleanup requests (for timeouts). */
  cleanupHang: boolean;
  /** Every authorised cleanup request: the Authorization header and the files listed. */
  cleanups: { authorization: string; files: FakeCleanupFile[] }[];
  /** Answer the next HTTP request with this status. */
  failNextWith: number | undefined;
  /** Never answer the next HTTP request (for timeouts). */
  hangNext: boolean;
  close(): Promise<void>;
}

export const progressFrame = (promptId: string, value: number, max: number): FakeFrame => ({
  type: "progress",
  data: { value, max, prompt_id: promptId, node: "3" },
});
export const executingFrame = (promptId: string, node: string | null): FakeFrame => ({
  type: "executing",
  data: { node, prompt_id: promptId },
});

async function readBody(req: http.IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

/** A real http + websocket server on an ephemeral loopback port that behaves like ComfyUI. */
export async function createFakeComfy(port = 0): Promise<FakeComfy> {
  const sockets = new Set<WebSocket>();
  let counter = 0;
  let pending: string | undefined;

  const fake: FakeComfy = {
    url: "",
    submitted: [],
    frees: [],
    interrupts: 0,
    uploads: [],
    uploadMeta: [],
    views: [],
    rejectNextPrompt: undefined,
    files: new Map(),
    history: new Map(),
    objectInfo: {},
    runScript: (promptId) => [executingFrame(promptId, "3"), executingFrame(promptId, null)],
    disconnectAfterScript: false,
    failNextWith: undefined,
    hangNext: false,
    cleanupToken: undefined,
    cleanupRoute: true,
    cleanupFailWith: undefined,
    cleanupHang: false,
    cleanups: [],
    close: async () => undefined,
  };

  const flush = (): void => {
    const open = [...sockets].filter((socket) => socket.readyState === socket.OPEN);
    if (!pending || open.length === 0) return;
    const promptId = pending;
    pending = undefined;
    for (const frame of fake.runScript(promptId)) {
      for (const socket of open) socket.send(JSON.stringify(frame));
    }
    if (fake.disconnectAfterScript) for (const socket of open) socket.terminate();
  };

  const server = http.createServer(async (req, res) => {
    const reply = (status: number, body: unknown): void => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (fake.hangNext) {
      fake.hangNext = false;
      return;
    }
    if (fake.failNextWith) {
      const status = fake.failNextWith;
      fake.failNextWith = undefined;
      reply(status, { error: "scripted failure" });
      return;
    }
    const url = new URL(req.url ?? "/", "http://fake");
    const body = req.method === "POST" ? await readBody(req) : Buffer.alloc(0);
    if (req.method === "POST" && url.pathname === "/prompt" && fake.rejectNextPrompt) {
      const rejection = fake.rejectNextPrompt;
      fake.rejectNextPrompt = undefined;
      reply(400, rejection);
    } else if (req.method === "POST" && url.pathname === "/prompt") {
      fake.submitted.push(JSON.parse(body.toString("utf8")));
      counter += 1;
      pending = `prompt-${counter}`;
      reply(200, { prompt_id: pending, number: counter, node_errors: {} });
      flush();
    } else if (url.pathname === "/system_stats") {
      reply(200, { system: { os: "fake" }, devices: [{ name: "Fake GPU" }] });
    } else if (url.pathname === "/object_info") {
      reply(200, fake.objectInfo);
    } else if (url.pathname.startsWith("/history/")) {
      const id = decodeURIComponent(url.pathname.slice("/history/".length));
      reply(200, fake.history.has(id) ? { [id]: fake.history.get(id) } : {});
    } else if (url.pathname === "/view") {
      fake.views.push({
        filename: url.searchParams.get("filename") ?? "",
        subfolder: url.searchParams.get("subfolder") ?? "",
        type: url.searchParams.get("type") ?? "",
      });
      const file = fake.files.get(url.searchParams.get("filename") ?? "");
      if (!file) return reply(404, { error: "missing" });
      res.writeHead(200, { "content-type": file.mime });
      res.end(file.bytes);
    } else if (req.method === "POST" && url.pathname === "/job-cleanup" && fake.cleanupRoute) {
      if (fake.cleanupHang) return;
      if (fake.cleanupFailWith) return reply(fake.cleanupFailWith, { error: "scripted failure" });
      if (!fake.cleanupToken) return reply(503, { error: "cleanup disabled" });
      const authorization = req.headers.authorization ?? "";
      if (authorization !== `Bearer ${fake.cleanupToken}`)
        return reply(401, { error: "unauthorized" });
      const parsed = JSON.parse(body.toString("utf8")) as { files: FakeCleanupFile[] };
      fake.cleanups.push({ authorization, files: parsed.files });
      reply(200, { deleted: parsed.files.length, missing: 0, refused: 0 });
    } else if (req.method === "POST" && url.pathname === "/interrupt") {
      fake.interrupts += 1;
      reply(200, {});
    } else if (req.method === "POST" && url.pathname === "/free") {
      fake.frees.push(JSON.parse(body.toString("utf8")));
      reply(200, {});
    } else if (req.method === "POST" && url.pathname === "/upload/image") {
      const form = body.toString("latin1");
      fake.uploads.push(form);
      const filename = /filename="([^"]*)"/.exec(form)?.[1] ?? "uploaded.png";
      const subfolder = /name="subfolder"\s+(\S+)/.exec(form)?.[1] ?? "";
      fake.uploadMeta.push({ filename, subfolder });
      reply(200, { name: filename, subfolder, type: "input" });
    } else {
      reply(404, { error: "no such route" });
    }
  });

  const wss = new WebSocketServer({ server, path: "/ws" });
  wss.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    flush();
  });

  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  fake.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  fake.close = async () => {
    for (const socket of sockets) socket.terminate();
    wss.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  };
  return fake;
}
