// Create or update a login user.
//
//   pnpm create-user <email> <password>
//
// Writes only an scrypt hash — the plaintext is never stored. Re-running with
// an existing email resets that user's password, which is also the recovery
// path if one is forgotten (there is no reset-by-email flow).
import { openDb } from "../src/store/db.js";
import { loadConfig } from "../src/config.js";
import { findUser, upsertUser } from "../src/auth.js";

const [, , email, password] = process.argv;

if (!email || !password) {
  console.error("usage: pnpm create-user <email> <password>");
  process.exit(1);
}

if (password.length < 12) {
  console.error("refusing: password must be at least 12 characters");
  process.exit(1);
}

const config = loadConfig();
const db = openDb(config.dbPath);
try {
  const existing = findUser(db, email);
  upsertUser(db, email, password);
  console.log(`${existing ? "updated" : "created"} user ${email.trim().toLowerCase()} in ${config.dbPath}`);
} finally {
  db.close();
}
