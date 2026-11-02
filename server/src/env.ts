import path from "node:path";
import dotenv from "dotenv";
import { z } from "zod";
import { AUTH_MODES } from "./auth/index.js";
import { assertNotRealDataInTests, baseEnvSchema, findRealDataDir } from "./core/kit/index.js";

// The repository root is where .env lives, whichever folder the server is started from.
const REPO_ROOT = path.resolve(import.meta.dirname, "../..");
dotenv.config({ path: path.join(REPO_ROOT, ".env"), quiet: true });

/** A path from .env, relative to the repository root. */
const repoPath = (value: string): string => path.resolve(REPO_ROOT, value);

/** The workspace's `data/` folder, or `./data` beside wherever the server is started. */
const DEFAULT_DATA_DIR = findRealDataDir() ?? path.resolve("data");
const DEFAULT_WORKFLOWS_DIR = path.resolve(import.meta.dirname, "../../workflows");

const flag = (fallback: "true" | "false") =>
  z
    .enum(["true", "false"])
    .default(fallback)
    .transform((value) => value === "true");

const envSchema = baseEnvSchema.extend({
  PORT: z.coerce.number().int().positive().default(3000),
  // Loopback by default: an install is private until the owner chooses otherwise.
  HOST: z.string().min(1).default("127.0.0.1"),
  // The server owns this directory (database, media, thumbnails, backups).
  DATA_DIR: z.string().min(1).transform(repoPath).default(DEFAULT_DATA_DIR),
  // Server-side only, never sent to the browser.
  COMFYUI_URL: z.string().url().default("http://127.0.0.1:8188"),
  // Optional shared secret for the job_cleanup extension on ComfyUI; unset leaves cleanup off.
  COMFYUI_CLEANUP_TOKEN: z.string().optional(),
  WORKFLOWS_DIR: z.string().min(1).transform(repoPath).default(DEFAULT_WORKFLOWS_DIR),
  // Workflows marked nsfw are hidden unless this is true.
  ALLOW_NSFW_WORKFLOWS: flag("true"),
  // A file whose default export builds a GpuGate, to share one GPU with other software.
  GPU_GATE_MODULE: z.string().optional(),
  AUTH_MODE: z.enum(AUTH_MODES).default("none"),
  AUTH_NONE_ALLOW_NETWORK: flag("false"),
  // proxy-header mode
  AUTH_HEADER: z
    .string()
    .min(1)
    .default("x-forwarded-user")
    .transform((value) => value.toLowerCase()),
  TRUSTED_PROXIES: z
    .string()
    .default("127.0.0.1,::1")
    .transform((value) =>
      value
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean),
    ),
  // token mode: id=secret,id2=secret2
  AUTH_TOKENS: z.string().optional(),
  // module mode: a file whose default export builds an AuthProvider.
  AUTH_MODULE: z.string().optional(),
  // Where media lives. Only "disk" exists for now; an S3-compatible backend is planned.
  MEDIA_STORE: z.enum(["disk"]).default("disk"),
  WEB_DIST_PATH: z.string().optional(),
});

export type AppEnv = z.infer<typeof envSchema>;

/** Parses and validates; throws a ZodError naming every bad variable. Exported for tests. */
export function parseEnv(source: NodeJS.ProcessEnv): AppEnv {
  const parsed = envSchema.parse(source);
  // A test run must never touch a real data directory (see isolateTestEnvironment).
  assertNotRealDataInTests("DATA_DIR", parsed.DATA_DIR);
  return parsed;
}

export const env = parseEnv(process.env);
