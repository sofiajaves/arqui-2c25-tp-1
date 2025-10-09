import { nanoid } from "nanoid";
import { StatsD } from "hot-shots";

import { init as stateInit, getAccounts as stateAccounts, getRates as stateRates, getLog as stateLog } from "./state.js";

const statsd = new StatsD({
  host: process.env.STATSD_HOST || "graphite",
  port: process.env.STATSD_PORT ? Number(process.env.STATSD_PORT) : 8125,
  prefix: (process.env.STATSD_PREFIX || "arVault") + "."
});

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
  const {
    baseCurrency,
    counterCurrency,
    baseAccountId: clientBaseAccountId,
    counterAccountId: clientCounterAccountId,
    baseAmount,
  } = exchangeRequest;

  const start = Date.now();

  //get the exchange rate
  const exchangeRate = rates[baseCurrency][counterCurrency];
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

  //check if we have funds on the counter currency account
  if (counterAccount.balance >= counterAmount) {
    //try to transfer from clients' base account
    if (await transfer(clientBaseAccountId, baseAccount.id, baseAmount)) {
      //try to transfer to clients' counter account
      if (
        await transfer(counterAccount.id, clientCounterAccountId, counterAmount)
      ) {
        //all good, update balances
        baseAccount.balance += baseAmount;
        counterAccount.balance -= counterAmount;
        exchangeResult.ok = true;
        exchangeResult.counterAmount = counterAmount;

        // business metrics: volume by currency (rounded for counter semantics)
        try {
          // Metrics
            statsd.increment(`volume.${baseCurrency}.acum`, Math.round(baseAmount));
            statsd.increment(`volume.${counterCurrency}.acum`, Math.round(counterAmount));
            statsd.increment(`volume.${baseCurrency}.neto`, -Math.round(baseAmount));
            statsd.increment(
              `volume.${counterCurrency}.neto`,
              Math.round(counterAmount)
            );
            statsd.increment(`volume.${baseCurrency}.sell`, Math.round(baseAmount));
            statsd.increment(
              `volume.${counterCurrency}.buy`,
              Math.round(counterAmount)
            );
        } catch (err) {}
      } else {
        // could not transfer to clients' counter account, return base amount to client
        await transfer(baseAccount.id, clientBaseAccountId, baseAmount);
        exchangeResult.obs = "Could not transfer to clients' account";
      
        try {
          process.stdout.write("[metrics] incrementing response.500\n");
          statsd.increment(`response.500`);
        } catch (err) {}
      }
    } else {
      // could not withdraw from clients' account
      exchangeResult.obs = "Could not withdraw from clients' account";
    
      try {
        process.stdout.write("[metrics] incrementing response.402\n");
        statsd.increment(`response.402`);
      } catch (err) {}
    }
  } else {
    // not enough funds on internal counter account
    exchangeResult.obs = "Not enough funds on counter currency account";
  
    try {
      process.stdout.write("[metrics] incrementing response.500\n");
      statsd.increment(`response.500`);
    } catch (err) {}
  }

  // timing of the whole request (ms)
  try {
    process.stdout.write("[metrics] timing exchange.request.duration\n");
    statsd.timing("exchange.duration", Date.now() - start);
  } catch (err) {}

  statsd.gauge(`account.${baseAccount.id}.balance`, baseAccount.balance);
  statsd.gauge(`account.${counterAccount.id}.balance`, counterAccount.balance);

  // log the transaction and return it
  log.push(exchangeResult);

  return exchangeResult;
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
