// Log Service: retrieving transaction logs
import { getLog as repoGetLog } from "../../redis.js";

export async function listLog() {
  return repoGetLog();
}
