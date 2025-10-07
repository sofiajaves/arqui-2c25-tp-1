import { nanoid } from "nanoid";
import { StatsD } from "hot-shots";
import { exchangeMutex } from './mutex.js';
import { init as stateInit, getAccounts as stateAccounts, getRates as stateRates, getLog as stateLog } from "./state.js";

// ID de instancia para métricas
const INSTANCE_ID = process.env.INSTANCE_ID || 'unknown';

const statsd = new StatsD({
  host: process.env.STATSD_HOST || "graphite",
  port: process.env.STATSD_PORT ? Number(process.env.STATSD_PORT) : 8125,
  prefix: (process.env.STATSD_PREFIX || "arVault") + "."
});

const currencies = ["USD", "ARS", "BRL", "EUR"];

let accounts;
let rates;
let log;

//call to initialize the exchange service
export async function init() {
  await stateInit();

  accounts = stateAccounts();
  rates = stateRates();
  log = stateLog();
}

//returns all internal accounts
export function getAccounts() {
  return accounts;
}

//sets balance for an account
export function setAccountBalance(accountId, balance) {
  const account = findAccountById(accountId);

  if (account != null) {
    account.balance = balance;
    try {
      statsd.gauge(`account.${accountId}.balance`, balance);
    } catch (err) {
      // ignore metric errors
    }
  }
}

//returns all current exchange rates
export function getRates() {
  return rates;
}

//returns the whole transaction log
export function getLog() {
  return log;
}

//sets the exchange rate for a given pair of currencies, and the reciprocal rate as well
export function setRate(rateRequest) {
  const { baseCurrency, counterCurrency, rate } = rateRequest;

  rates[baseCurrency][counterCurrency] = rate;
  rates[counterCurrency][baseCurrency] = Number((1 / rate).toFixed(5));

  try {
    statsd.gauge(`rate.${baseCurrency}.${counterCurrency}`, rate);
  } catch (err) {}
}

//executes an exchange operation
export async function exchange(exchangeRequest) {
  try {
    const {
      baseCurrency,
      counterCurrency,
      baseAccountId: clientBaseAccountId,
      counterAccountId: clientCounterAccountId,
      baseAmount,
    } = exchangeRequest;

    const start = Date.now();

    // VALIDACIONES CON LOCK (previene race conditions)
    if (!baseCurrency || !counterCurrency || !baseAmount || !clientBaseAccountId || !clientCounterAccountId) {
      return {
        id: nanoid(),
        ts: new Date(),
        status: 400,
        request: exchangeRequest,
        obs: "Missing required fields"
      };
    }

    if (!baseCurrency in currencies || !counterCurrency in currencies) {
      return {
        id: nanoid(),
        ts: new Date(),
        status: 400,
        request: exchangeRequest,
        obs: "Invalid currency"
      };
    }

    if (typeof baseAmount !== 'number' || baseAmount <= 0) {
      return {
        id: nanoid(),
        ts: new Date(),
        status: 400,
        request: exchangeRequest,
        obs: "baseAmount must be a positive number"
      };
    }

    //get the exchange rate
    const exchangeRate = rates[baseCurrency][counterCurrency];
    
    // VALIDAR QUE LA TASA EXISTA
    if (!exchangeRate) {
      return {
        id: nanoid(),
        ts: new Date(),
        status: 400,
        request: exchangeRequest,
        obs: `Exchange rate not available for ${baseCurrency}/${counterCurrency}`
      };
    }
    
    //compute the requested (counter) amount
    const counterAmount = baseAmount * exchangeRate;
    //find our account on the provided (base) currency
    const baseAccount = findAccountByCurrency(baseCurrency);
    //find our account on the counter currency
    const counterAccount = findAccountByCurrency(counterCurrency);

    //construct the result object with defaults
    const exchangeResult = {
      id: nanoid(),
      ts: new Date(),
      ok: false,
      request: exchangeRequest,
      exchangeRate: exchangeRate,
      counterAmount: 0.0,
      obs: null,
    };

    // increment request counter for throughput
    try {
      process.stdout.write("[metrics] incrementing requests.exchange\n");
      statsd.increment("requests.exchange");
    } catch (err) {}

    // await exchangeMutex.lock();

    //check if we have funds on the counter currency account
    if (counterAccount.balance >= counterAmount) {
      counterAccount.balance -= counterAmount;
      // try to transfer from clients' base account
      if (await transfer(clientBaseAccountId, baseAccount.id, baseAmount)) {
        // try to transfer to clients' counter account
        if (await transfer(counterAccount.id, clientCounterAccountId, counterAmount)) {
          // TRANSACCIÓN ATÓMICA: Actualizar balances juntos con lock
          baseAccount.balance += baseAmount;
          // counterAccount.balance -= counterAmount;
          exchangeResult.status = 200;
          exchangeResult.counterAmount = counterAmount;

          // business metrics: volume by currency (rounded for counter semantics)
          try {
            process.stdout.write(`[metrics] incrementing volume.${baseCurrency}.sell by ${Math.round(baseAmount)}\n`);
            process.stdout.write(`[metrics] incrementing volume.${counterCurrency}.buy by ${Math.round(counterAmount)}\n`);
            statsd.increment(`volume.${baseCurrency}.sell`, Math.round(baseAmount));
            statsd.increment(`volume.${counterCurrency}.buy`, Math.round(counterAmount));
            
            // Métricas por instancia
            statsd.gauge(`instances.${INSTANCE_ID}.active_transactions`, 1);
            statsd.increment(`instances.${INSTANCE_ID}.successful_exchanges`);
          } catch (err) {}
        } else {
          // could not transfer to clients' counter account, return base amount to client
          await transfer(baseAccount.id, clientBaseAccountId, baseAmount);
          exchangeResult.obs = "Could not transfer to clients' account";
          counterAccount.balance += counterAmount;
        
          try {
            process.stdout.write("[metrics] incrementing response.500\n");
            statsd.increment(`response.500`);
            statsd.increment(`instances.${INSTANCE_ID}.failed_exchanges`);
          } catch (err) {}
        }
      } else {
        // could not withdraw from clients' account
        counterAccount.balance += counterAmount;
        exchangeResult.obs = "Could not withdraw from clients' account";
      
        try {
          process.stdout.write("[metrics] incrementing response.402\n");
          statsd.increment(`response.402`);
          statsd.increment(`instances.${INSTANCE_ID}.failed_exchanges`);
        } catch (err) {}
      }
    } else {
      // not enough funds on internal counter account
      exchangeResult.obs = "Not enough funds on counter currency account";
    
      try {
        process.stdout.write("[metrics] incrementing response.500\n");
        statsd.increment(`response.500`);
        statsd.increment(`instances.${INSTANCE_ID}.failed_exchanges`);
      } catch (err) {}
    }

    // timing of the whole request (ms)
    try {
      process.stdout.write("[metrics] timing exchange.request.duration\n");
      statsd.timing("exchange.request.duration", Date.now() - start);
      statsd.gauge(`account.${baseAccount.id}.balance`, baseAccount.balance);
      statsd.gauge(`account.${counterAccount.id}.balance`, counterAccount.balance);
    } catch (err) {}

    // log the transaction and return it
    log.push(exchangeResult);

    return exchangeResult;
    
  } finally {
    exchangeMutex.unlock();
  }
}

// internal - call transfer service to execute transfer between accounts
async function transfer(fromAccountId, toAccountId, amount) {
  const start = Date.now();
  const min = 200;
  const max = 400;
  const delay = Math.random() * (max - min + 1) + min;

  return new Promise((resolve) =>
    setTimeout(() => {
      resolve(true);
    }, delay)
  );
}

function findAccountByCurrency(currency) {
  for (let account of accounts) {
    if (account.currency == currency) {
      return account;
    }
  }

  return null;
}

function findAccountById(id) {
  for (let account of accounts) {
    if (account.id == id) {
      return account;
    }
  }

  return null;
}
