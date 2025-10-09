// Accounts Controller
import {
  listAccounts,
  updateAccountBalance,
} from "../services/accountsService.js";

// Obtener contraseña de variable de entorno
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "defaultadmin123";

export async function getAccountsController(req, res) {
  try {
    const accounts = await listAccounts();
    res.json(accounts);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
}

export async function putAccountBalanceController(req, res) {
  const accountId = req.params.id;
  const { balance, password } = req.body;

  // Validaciones
  if (!accountId || balance === undefined) {
    return res.status(400).json({ error: "Malformed request" });
  }

  if (!password) {
    return res.status(400).json({ error: "Password required" });
  }

  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: "Invalid password" });
  }

  try {
    const accounts = await updateAccountBalance(accountId, balance);
    res.json(accounts);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
}
