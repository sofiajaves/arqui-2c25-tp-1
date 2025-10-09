// Accounts Service: business logic related to accounts
import {
  getAccounts as repoGetAccounts,
  setAccountBalance as repoSetAccountBalance,
} from "../../redis.js";

export async function listAccounts() {
  return repoGetAccounts();
}

export async function updateAccountBalance(accountId, balance) {
  await repoSetAccountBalance(accountId, balance);
  return repoGetAccounts();
}
