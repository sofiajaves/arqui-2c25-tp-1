import express from "express";
import {
  init as redisInit,
  disconnect as redisDisconnect,
  setAccountBalance,
  getPendingTxs,
  getAccounts,
  getRates,
  setRate,
  getLog,
} from "./redis.js";
import routes from "./src/routes.js";
import { exchange } from "./src/services/exchangeService.js";

// Initialize Redis (idempotent single connection)
await redisInit();

const pendingTxs = await getPendingTxs();

for (const tx of pendingTxs) {
  console.log(`Procesando tx pendiente: ${tx.id}`);
  await exchange(tx, true);
}

const app = express();
const port = 3000;

app.use(express.json());

// Mount routes
app.use("/", routes);

app.listen(port, "0.0.0.0", () => {
  console.log(`Exchange API listening on port ${port}`);
});

// Graceful shutdown
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    console.log(`\nReceived ${signal}, shutting down...`);
    await redisDisconnect();
    process.exit(0);
  });
}

export default app;
