import { isolateTestEnvironment } from "../core/kit/test/index.js";

// Runs before every test file: DATA_DIR (and BACKUP_DIR) point at a throwaway directory and
// dotenv at a file that does not exist, so no test can reach data/ or a developer's .env.
isolateTestEnvironment({ runPrefix: "comfy-test", dirEnvVars: ["DATA_DIR"] });
