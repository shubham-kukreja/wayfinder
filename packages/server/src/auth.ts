import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type Database from "better-sqlite3";

// Password hashing uses Node's built-in scrypt rather than bcrypt/argon2 from
// npm: both of those are native modules, and this project already lost a day
// to better-sqlite3 failing to find a prebuilt binary on the deploy image.
// scrypt is memory-hard and in the standard library, so there is nothing to
// compile. N=32768 costs ~66ms per verification here — cheap for one login,
// expensive for an attacker grinding a stolen hash.
const SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 256 * 1024 * 1024 } as const;
const KEY_LEN = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, KEY_LEN, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("hex")}$${key.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, saltHex, keyHex] = parts;
  try {
    const salt = Buffer.from(saltHex!, "hex");
    const expected = Buffer.from(keyHex!, "hex");
    const actual = scryptSync(password, salt, expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
      maxmem: 256 * 1024 * 1024,
    });
    // Constant-time: a plain === leaks how many leading bytes matched.
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

// --- session tokens -------------------------------------------------------
//
// A signed, expiring token rather than a random one stored server-side: this
// keeps sessions stateless, so there is no session table to migrate and no
// cleanup job. The tradeoff is that a token cannot be revoked individually
// before it expires — rotating AUTH_TOKEN_SECRET invalidates all of them.

export interface TokenPayload {
  email: string;
  exp: number;
}

function sign(data: string, secret: string): string {
  return createHmac("sha256", secret).update(data).digest("base64url");
}

export function issueToken(email: string, secret: string, ttlHours = 24 * 7): string {
  const payload: TokenPayload = { email, exp: Date.now() + ttlHours * 3600 * 1000 };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body, secret)}`;
}

export function verifyToken(token: string, secret: string): TokenPayload | null {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;

  // Compare signatures in constant time, and only then trust the payload.
  const expected = sign(body, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as TokenPayload;
    if (typeof payload.exp !== "number" || Date.now() > payload.exp) return null;
    if (typeof payload.email !== "string") return null;
    return payload;
  } catch {
    return null;
  }
}

// --- user store -----------------------------------------------------------

export interface UserRow {
  email: string;
  password_hash: string;
  created_at: string;
  last_login_at: string | null;
}

export function findUser(db: Database.Database, email: string): UserRow | undefined {
  return db
    .prepare("select email, password_hash, created_at, last_login_at from users where email = ?")
    .get(email.trim().toLowerCase()) as UserRow | undefined;
}

export function upsertUser(db: Database.Database, email: string, password: string): void {
  db.prepare(
    `insert into users (email, password_hash, created_at)
     values (?, ?, ?)
     on conflict(email) do update set password_hash = excluded.password_hash`,
  ).run(email.trim().toLowerCase(), hashPassword(password), new Date().toISOString());
}

export function recordLogin(db: Database.Database, email: string): void {
  db.prepare("update users set last_login_at = ? where email = ?").run(
    new Date().toISOString(),
    email.trim().toLowerCase(),
  );
}
