import fs from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import type { Express, NextFunction, Request, Response } from "express";
import sharp from "sharp";
import { createComfyClient } from "../comfy/client.js";
import type { AppConfig } from "../config.js";
import { createHttpApp } from "../core/kit/index.js";
import { MemoryGpuGate } from "../jobs/memoryGpuGate.js";
import { apiRoutes } from "../routes/index.js";
import { type AppServices, createAppServices } from "../services.js";
import type { MediaBackend } from "../storage/mediaBackend.js";
import { createFakeComfy, type FakeComfy, type FakeFrame, progressFrame } from "./fakeComfy.js";
import { removeQuietly } from "./testApp.js";
import { writeTestWorkflows } from "./testWorkflows.js";

export const ALICE = "alice@example.com";
export const BOB = "bob@example.com";
export const USER_HEADER = "x-test-user";

/** Test-only switches layered over the real fake ComfyUI server. */
export interface ComfyControl {
  /** Every request fails as if the host were down. */
  offline: boolean;
  /** The next N POST /prompt calls answer 503. */
  failSubmits: number;
}

export interface HarnessOptions {
  /** Start the worker, registry refresh and recovery. Default true. */
  start?: boolean;
  allowNsfw?: boolean;
  retryDelaysMs?: readonly number[];
  /** Called for every injected delay (instead of waiting). */
  onDelay?: (ms: number) => void | Promise<void>;
  heartbeatMs?: number;
  /** Reuse a data directory (restart tests). */
  dataDir?: string;
  /** Reuse a fake ComfyUI (restart tests). */
  comfy?: FakeComfy;
  /** Turns on ComfyUI cleanup: the client sends this token and the fake extension accepts it. */
  cleanupToken?: string;
  cleanupTimeoutMs?: number;
  /** Store media in this backend instead of the temp directory (a fake bucket). */
  media?: MediaBackend;
}

export interface Harness {
  app: Express;
  services: AppServices;
  gate: MemoryGpuGate;
  comfy: FakeComfy;
  control: ComfyControl;
  dataDir: string;
  /** Everything the services logged as a warning. */
  warnings: string[];
  /** Delays the worker asked for, in order. */
  delays: number[];
  /** Serves the app on a loopback port (SSE needs a real socket). */
  listen(): Promise<{ baseUrl: string; close(): Promise<void> }>;
  close(): Promise<void>;
}

export async function makePng(width = 64, height = 48): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 200, g: 30, b: 90 } },
  })
    .png()
    .toBuffer();
}

/** Makes the fake ComfyUI finish every prompt with one PNG output. */
export async function scriptSuccess(
  comfy: FakeComfy,
  options: { frames?: (promptId: string) => FakeFrame[]; outputs?: number } = {},
): Promise<void> {
  const png = await makePng();
  const count = options.outputs ?? 1;
  const refs = Array.from({ length: count }, (_, index) => {
    const filename = `out-${index}.png`;
    comfy.files.set(filename, { mime: "image/png", bytes: png });
    return { filename, subfolder: "", type: "output" };
  });
  comfy.runScript = (promptId) => {
    comfy.history.set(promptId, {
      status: { status_str: "success", completed: true },
      outputs: { "9": { images: refs } },
    });
    return [
      ...(options.frames?.(promptId) ?? [
        progressFrame(promptId, 1, 4),
        progressFrame(promptId, 4, 4),
      ]),
      { type: "executing", data: { node: null, prompt_id: promptId } },
    ];
  };
}

function testIdentity(req: Request, _res: Response, next: NextFunction): void {
  const email = req.header(USER_HEADER);
  if (email) req.ownerId = email;
  next();
}

function requireTestOwner(req: Request, res: Response, next: NextFunction): void {
  if (req.ownerId) {
    next();
    return;
  }
  res.status(401).json({ error: "Authentication required" });
}

/** A fully isolated app: temp data directory, fake ComfyUI, in-memory GPU gate, two-user auth. */
export async function createHarness(options: HarnessOptions = {}): Promise<Harness> {
  const dataDir = options.dataDir ?? fs.mkdtempSync(path.join(os.tmpdir(), "comfy-test-data-"));
  const comfy = options.comfy ?? (await createFakeComfy());
  await scriptSuccess(comfy);
  comfy.objectInfo = {
    KSampler: { input: { required: {} } },
    CheckpointLoaderSimple: { input: { required: { ckpt_name: [["fixture-model.safetensors"]] } } },
    EmptyLatentImage: { input: { required: {} } },
    CLIPTextEncode: { input: { required: {} } },
    VAEDecode: { input: { required: {} } },
    SaveImage: { input: { required: {} } },
    LoadImage: { input: { required: {} } },
    FixtureMediaLoader: { input: { required: {} } },
  };
  const control: ComfyControl = { offline: false, failSubmits: 0 };
  const delays: number[] = [];
  const warnings: string[] = [];
  if (options.cleanupToken) comfy.cleanupToken = options.cleanupToken;
  const workflowsDir = writeTestWorkflows(dataDir);
  const config: AppConfig = {
    dataDir,
    comfyUrl: comfy.url,
    workflowsDir,
    allowNsfwWorkflows: options.allowNsfw ?? true,
  };
  const gate = new MemoryGpuGate("comfy");
  const client = createComfyClient({
    baseUrl: comfy.url,
    fetch: async (input, init) => {
      if (control.offline) throw new TypeError("fetch failed");
      if (control.failSubmits > 0 && String(input).endsWith("/prompt") && init?.method === "POST") {
        control.failSubmits -= 1;
        return new Response("down", { status: 503 });
      }
      return fetch(input, init);
    },
    idleTimeoutMs: 5_000,
    cleanupToken: options.cleanupToken,
    cleanupTimeoutMs: options.cleanupTimeoutMs,
  });
  const services = await createAppServices(config, {
    gate,
    media: options.media,
    comfy: client,
    retryDelaysMs: options.retryDelaysMs ?? [1, 1, 1],
    pollIntervalMs: 20,
    heartbeatMs: options.heartbeatMs,
    systemCacheMs: 0,
    delay: async (ms) => {
      delays.push(ms);
      await options.onDelay?.(ms);
      await new Promise((resolve) => setImmediate(resolve));
    },
    log: {
      log: () => undefined,
      warn: (message: unknown) => void warnings.push(String(message)),
      error: () => undefined,
    },
  });
  if (options.start !== false) await services.start();
  else await services.ctx.registry.refresh();

  const app = createHttpApp({
    gate: (instance) => {
      instance.use("/api", testIdentity, requireTestOwner);
    },
    mount: (instance) => {
      instance.use("/api", apiRoutes(services));
    },
  });

  const servers = new Set<Server>();
  return {
    app,
    services,
    gate,
    comfy,
    control,
    dataDir,
    warnings,
    delays,
    async listen() {
      const server = await new Promise<Server>((resolve) => {
        const created = app.listen(0, "127.0.0.1", () => resolve(created));
      });
      servers.add(server);
      const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      return {
        baseUrl,
        close: () =>
          new Promise<void>((resolve) => {
            server.closeAllConnections();
            server.close(() => resolve());
          }),
      };
    },
    async close() {
      for (const server of servers) server.closeAllConnections();
      await services.stop();
      if (!options.comfy) await comfy.close();
      removeQuietly(dataDir);
    },
  };
}

/** Polls until `check` returns a value or the timeout passes. */
export async function until<T>(
  check: () => Promise<T | undefined | false> | T | undefined | false,
  timeoutMs = 8_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error("Timed out waiting for a condition");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
