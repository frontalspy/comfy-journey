import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface IsolateTestEnvironmentOptions {
  /** Prefix for the throwaway directory, e.g. "server-test". */
  runPrefix: string;
  /** Path-valued env vars (upload dirs...) pointed at subdirectories of the throwaway directory. */
  dirEnvVars?: readonly string[];
}

/**
 * A vitest `setupFiles` entry's body: the default every test file starts from, so a test that
 * imports app code statically (or never calls `createTestContext`) still cannot reach the real
 * `data/` directory or a developer's `.env`.
 *
 * `DATABASE_PATH`, `BACKUP_DIR` and the given directory vars are set to a per-worker temp
 * directory (removed on exit), and dotenv is pointed at a file that does not exist. This
 * overrides whatever the shell had, deliberately. `createTestContext` then gives each test app
 * its own database on top of this baseline.
 */
export function isolateTestEnvironment(options: IsolateTestEnvironmentOptions): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `${options.runPrefix}-baseline-`));
  process.env.DATABASE_PATH = path.join(root, "baseline.sqlite");
  process.env.BACKUP_DIR = path.join(root, "backups");
  for (const name of options.dirEnvVars ?? []) {
    process.env[name] = path.join(root, name.toLowerCase());
  }
  process.env.DOTENV_CONFIG_PATH = path.join(root, "no-such.env");
  process.once("exit", () => {
    try {
      fs.rmSync(root, { recursive: true, force: true });
    } catch {
      // Windows can briefly hold a handle on the SQLite file; the OS temp dir is swept anyway.
    }
  });
  return root;
}
