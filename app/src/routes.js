import express from "express";
import {
  getAccountsController,
  putAccountBalanceController,
} from "./controllers/accounts.js";
import { getRatesController, putRatesController } from "./controllers/rates.js";
import { getLogController } from "./controllers/log.js";
import { postExchangeController } from "./controllers/exchange.js";

// Create an isolated router instead of mutating the app directly
const router = express.Router();

// ACCOUNT endpoints

router.get("/accounts", getAccountsController);

router.put("/accounts/:id/balance", putAccountBalanceController);

// RATE endpoints
router.get("/rates", getRatesController);

router.put("/rates", putRatesController);

// LOG endpoint
router.get("/log", getLogController);

// EXCHANGE endpoint

router.post("/exchange", postExchangeController);

export default router;
