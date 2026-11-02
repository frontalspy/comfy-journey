import fs from "node:fs";
import path from "node:path";

/**
 * The repo's real `data/` directory (the database, backups and
 * media of a development install), found by walking up from this file to the workspace root. `undefined` when the code is
 * not running inside the workspace, in which case there is nothing to protect.
 */
export function findRealDataDir(startDir: string = import.meta.dirname): string | undefined {
  let dir = path.resolve(startDir);
  for (;;) {
    const manifest = path.join(dir, "package.json");
    if (fs.existsSync(manifest)) {
      try {
        const parsed: unknown = JSON.parse(fs.readFileSync(manifest, "utf8"));
        if (typeof parsed === "object" && parsed !== null && "workspaces" in parsed) {
          return path.join(dir, "data");
        }
      } catch {
        // An unreadable manifest is not the workspace root; keep walking.
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

function normalise(target: string): string {
  const resolved = path.resolve(target);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

/** True when `candidate` is `directory` itself or anything beneath it. */
export function isInsideDirectory(candidate: string, directory: string): boolean {
  const relative = path.relative(normalise(directory), normalise(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/** Throws if `target` is the repo's real `data/` directory or inside it. */
export function assertNotRealData(
  label: string,
  target: string,
  dataDir: string | undefined = findRealDataDir(),
): void {
  if (!dataDir || !isInsideDirectory(target, dataDir)) return;
  throw new Error(
    `${label} (${path.resolve(target)}) is inside the real data directory ${dataDir}. ` +
      "Tests and test-run scripts must use a throwaway temp directory, never live data.",
  );
}

/**
 * Whether this process is a test run. Vitest sets VITEST in every worker, and child processes a
 * test spawns inherit it; COMFY_REFUSE_REAL_DATA lets a script opt in explicitly.
 */
export function isTestRun(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.VITEST) || env.COMFY_REFUSE_REAL_DATA === "1";
}

/** The always-on safety net: opening or writing real data during a test run is a hard error. */
export function assertNotRealDataInTests(label: string, target: string): void {
  if (isTestRun()) assertNotRealData(label, target);
}
