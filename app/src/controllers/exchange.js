// Exchange Controller
import { exchange as executeExchange } from "../services/exchangeService.js";

export async function postExchangeController(req, res) {
  const {
    baseCurrency,
    counterCurrency,
    baseAccountId,
    counterAccountId,
    baseAmount,
  } = req.body;

  if (
    !baseCurrency ||
    !counterCurrency ||
    !baseAccountId ||
    !counterAccountId ||
    baseAmount === undefined
  ) {
    return res.status(400).json({ error: "Malformed request" });
  }

  const exchangeRequest = {
    baseCurrency,
    counterCurrency,
    baseAccountId,
    counterAccountId,
    baseAmount,
  };
  const exchangeResult = await executeExchange(exchangeRequest);
  res.status(exchangeResult.status).json(exchangeResult);
}
