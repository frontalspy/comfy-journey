import { env } from "../env.js";
import { openAppDb } from "./client.js";

const handle = await openAppDb(env.DATA_DIR);
handle.client.close();
console.log("Migrations applied.");
