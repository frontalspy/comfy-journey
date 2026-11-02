import { configFromEnv } from "../config.js";
import { runBackupCli } from "../core/kit/index.js";
import { env } from "../env.js";
import { createAppBackup } from "./backup.js";
import { openAppDb } from "./client.js";

const config = configFromEnv(env);
const handle = await openAppDb(config.dataDir);
await runBackupCli(createAppBackup(config, handle));
