// Rates Controller
import { listRates, upsertRate } from "../services/ratesService.js";

// Obtener contraseña de variable de entorno
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "defaultadmin123";

export async function getRatesController(req, res) {
  const rates = await listRates();
  res.json(rates);
}

export async function putRatesController(req, res) {
  const { baseCurrency, counterCurrency, rate, password } = req.body;
  
  if (!baseCurrency || !counterCurrency || rate === undefined) {
    return res.status(400).json({ error: "Malformed request" });
  }

  if (!password) {
    return res.status(400).json({ error: "Password required" });
  }

  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: "Invalid password" });
  }

  const rates = await upsertRate({ baseCurrency, counterCurrency, rate });
  res.json(rates);
}
