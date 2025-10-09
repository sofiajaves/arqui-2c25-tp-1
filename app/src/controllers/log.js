// Log Controller
import { listLog } from "../services/logService.js";

export async function getLogController(req, res) {
  const log = await listLog();
  res.json(log);
}
