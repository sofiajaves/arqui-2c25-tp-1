// Rates Service: business logic related to currency rates
import {
  getRates as repoGetRates,
  setRate as repoSetRate,
} from "../../redis.js";

export async function listRates() {
  return repoGetRates();
}

export async function upsertRate({ baseCurrency, counterCurrency, rate }) {
  await repoSetRate(baseCurrency, counterCurrency, rate);
  return repoGetRates();
}
