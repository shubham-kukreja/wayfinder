import type { FastifyInstance } from "fastify";
import { openDb } from "../store/db.js";
import { loadConfig } from "../config.js";
import { findUser, issueToken, recordLogin, verifyPassword, verifyToken } from "../auth.js";

interface LoginBody {
  email?: unknown;
  password?: unknown;
}

export function registerLoginRoute(app: FastifyInstance): void {
  app.post<{ Body: LoginBody }>("/api/login", async (req, reply) => {
    const config = loadConfig();
    if (!config.authTokenSecret) {
      return reply.code(503).send({ error: "login is not configured on this server" });
    }

    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    if (!email || !password) {
      return reply.code(400).send({ error: "email and password are required" });
    }

    const db = openDb(config.dbPath);
    try {
      const user = findUser(db, email);

      // Same response for an unknown email and a wrong password, so this
      // cannot be used to enumerate which accounts exist.
      if (!user || !verifyPassword(password, user.password_hash)) {
        req.log.warn({ email }, "failed login attempt");
        return reply.code(401).send({ error: "invalid email or password" });
      }

      recordLogin(db, email);
      const token = issueToken(email, config.authTokenSecret);
      return { token, email };
    } finally {
      db.close();
    }
  });

  // Lets the web app check a stored token on load without having to make a
  // mutating request just to discover the session expired.
  app.get("/api/session", async (req, reply) => {
    const config = loadConfig();
    if (!config.authTokenSecret) return reply.code(503).send({ error: "login is not configured" });

    const header = req.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
    const payload = token ? verifyToken(token, config.authTokenSecret) : null;
    if (!payload) return reply.code(401).send({ error: "invalid or expired session" });

    return { email: payload.email, expiresAt: new Date(payload.exp).toISOString() };
  });
}
