// Exchange Service: core business logic for currency exchange
// Agnostic of HTTP layer; returns domain objects with status + metadata
import { nanoid } from "nanoid";
import { StatsD } from "hot-shots";
import {
  getAccountByCurrency,
  getRate,
  creditFunds,
  addLogEntry,
  startTx,
  setTxState,
  cleanupTx,
  reserveFunds,
  commitFunds,
  rollbackFunds,
} from "../../redis.js";

const statsd = new StatsD({
  host: process.env.STATSD_HOST || "graphite",
  port: process.env.STATSD_PORT ? Number(process.env.STATSD_PORT) : 8125,
  prefix: (process.env.STATSD_PREFIX || "arVault") + ".",
});

const SUPPORTED_CURRENCIES = ["USD", "ARS", "BRL", "EUR"];

// Public API
export async function executeExchange(exchangeRequest) {
  return exchange(exchangeRequest);
}

export async function exchange(exchangeRequest, resume = false) {
  const txid = nanoid();
  const start = Date.now();

  const {
    baseCurrency,
    counterCurrency,
    baseAccountId: clientBaseAccountId,
    counterAccountId: clientCounterAccountId,
    baseAmount,
  } = exchangeRequest;

  const baseAccount = await getAccountByCurrency(baseCurrency);
  const counterAccount = await getAccountByCurrency(counterCurrency);
  const exchangeRate = await getRate(baseCurrency, counterCurrency);
  const counterAmount = exchangeRate ? baseAmount * exchangeRate : undefined;

  const result = {
    id: txid,
    ts: new Date(),
    status: 500,
    request: exchangeRequest,
    exchangeRate,
    counterAmount,
    obs: "Unknown error",
  };

  // ---- VALIDATIONS ----
  if (
    !SUPPORTED_CURRENCIES.includes(baseCurrency) ||
    !SUPPORTED_CURRENCIES.includes(counterCurrency)
  ) {
    result.status = 400;
    result.obs = "Invalid currency";
    return result;
  }
  if (!baseAccount || !counterAccount) {
    result.status = 404;
    result.obs = "Internal account not found";
    return result;
  }
  if (typeof baseAmount !== "number" || baseAmount <= 0) {
    result.status = 400;
    result.obs = "BaseAmount must be a positive number";
    return result;
  }
  if (!exchangeRate) {
    result.status = 400;
    result.obs = `Exchange rate not available for ${baseCurrency}/${counterCurrency}`;
    return result;
  }

  // ---- PROCESS ----
  if (!resume) {
    await startTx(txid, { exchangeRequest });
  }

  let clientToInternalOK = false;
  let internalToClientOK = false;

  try {
    const reserved = await reserveFunds(counterAccount.id, counterAmount);
    if (!reserved)
      throw new Error("Not enough liquidity in internal counter account");

    const [t1, t2] = await Promise.allSettled([
      transfer(clientBaseAccountId, baseAccount.id, baseAmount),
      transfer(counterAccount.id, clientCounterAccountId, counterAmount),
    ]);

    clientToInternalOK = t1.status === "fulfilled" && t1.value;
    internalToClientOK = t2.status === "fulfilled" && t2.value;

    if (!clientToInternalOK || !internalToClientOK) {
      throw new Error("Transfer failed");
    }

    const committed = await commitFunds(counterAccount.id, counterAmount);
    if (!committed) throw new Error("Commit failed on counter account");

    await creditFunds(baseAccount.id, baseAmount);

    await setTxState(txid, "committed");
    result.status = 200;
    result.obs = null;

    // Metrics
    safeMetric(() =>
      statsd.increment(`volume.${baseCurrency}.acum`, Math.round(baseAmount))
    );
    safeMetric(() =>
      statsd.increment(`volume.${counterCurrency}.acum`, Math.round(baseAmount))
    );
    safeMetric(() =>
      statsd.increment(`volume.${baseCurrency}.neto`, -Math.round(baseAmount))
    );
    safeMetric(() =>
      statsd.increment(
        `volume.${counterCurrency}.neto`,
        Math.round(counterAmount)
      )
    );
    safeMetric(() =>
      statsd.increment(`volume.${baseCurrency}.sell`, Math.round(baseAmount))
    );
    safeMetric(() =>
      statsd.increment(
        `volume.${counterCurrency}.buy`,
        Math.round(counterAmount)
      )
    );
  } catch (err) {
    console.error(`[tx:${txid}] rollback ->`, err.message);

    if (clientToInternalOK) {
      console.log(`[tx:${txid}] reverting transfer client->internal`);
      await transfer(baseAccount.id, clientBaseAccountId, baseAmount);
    }

    if (internalToClientOK) {
      console.log(`[tx:${txid}] reverting transfer internal->client`);
      await transfer(clientCounterAccountId, counterAccount.id, counterAmount);
    }

    await rollbackFunds(counterAccount.id, counterAmount);
    await setTxState(txid, "rolledback");

    result.status = 500;
    result.obs = err.message;
  } finally {
    await cleanupTx(txid);

    const duration = Date.now() - start;
    safeMetric(() =>
      statsd.gauge(`account.${baseAccount.id}.balance`, baseAccount.balance)
    );
    safeMetric(() =>
      statsd.gauge(
        `account.${counterAccount.id}.balance`,
        counterAccount.balance
      )
    );
    safeMetric(() => statsd.timing("exchange.duration", duration));
    await addLogEntry(result);
  }

  return result;
}

export async function resumeExchange(tx) {
  const {
    baseCurrency,
    counterCurrency,
    baseAccountId,
    counterAccountId,
    baseAmount,
  } = tx;
  const result = await exchange(
    {
      baseCurrency,
      counterCurrency,
      baseAccountId,
      counterAccountId,
      baseAmount,
    },
    true
  );
  console.log(`[tx:${tx.id}] resultado re-procesado:`, result.status);
  return result;
}

// ---- Internal helpers ----
function transfer(fromAccountId, toAccountId, amount) {
  const min = 200;
  const max = 400;
  const delay = Math.random() * (max - min + 1) + min;
  return new Promise((resolve) => setTimeout(() => resolve(true), delay));
}

function safeMetric(fn) {
  try {
    fn();
  } catch (_) {
    /* swallow metric errors */
  }
}
