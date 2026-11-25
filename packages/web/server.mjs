// Static file server + API proxy for the deployed web app.
//
// Two jobs:
//  1. Serve the Vite build with an SPA fallback, so a hard refresh on a
//     client-side route (/clients/kabir-sethi) returns index.html rather
//     than 404.
//  2. Proxy /v1/* to core-jobs-service. The app and the API then share one
//     origin, which core's SameSite=Strict session and CSRF cookies need,
//     and the API needs no public domain at all.
//
// API_ORIGIN is the API service's PRIVATE Railway address, e.g.
// http://api.railway.internal:8080.
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const PORT = Number(process.env.PORT) || 8080;
const DIST = join(import.meta.dirname, "dist");
const API_ORIGIN = process.env.API_ORIGIN;
const MAX_BODY = 21 * 1024 * 1024; // core accepts uploads up to 20 MB

if (!API_ORIGIN) {
  console.warn("API_ORIGIN is unset — /v1/* requests will 502.");
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
};

// Hop-by-hop headers are for one connection, not for forwarding.
const HOP = new Set(["connection", "keep-alive", "proxy-connection", "transfer-encoding", "upgrade", "te", "trailer", "host", "content-length"]);

async function proxy(req, res) {
  if (!API_ORIGIN) {
    res.writeHead(502, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { code: "bad_gateway", message: "API_ORIGIN not configured" } }));
    return;
  }

  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) {
      res.writeHead(413, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { code: "payload_too_large", message: "Request body too large" } }));
      return;
    }
    chunks.push(chunk);
  }
  const body = chunks.length > 0 ? Buffer.concat(chunks) : undefined;

  const headers = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (!HOP.has(k) && v !== undefined) headers[k] = Array.isArray(v) ? v.join(", ") : v;
  }
  // Keep the public host and scheme visible to the API, and append the
  // caller to X-Forwarded-For (core trusts it only from the private network).
  headers["x-forwarded-host"] = req.headers.host ?? "";
  headers["x-forwarded-proto"] = req.headers["x-forwarded-proto"] ?? "https";
  const peer = req.socket.remoteAddress ?? "";
  headers["x-forwarded-for"] = req.headers["x-forwarded-for"] ? `${req.headers["x-forwarded-for"]}, ${peer}` : peer;

  try {
    const upstream = await fetch(new URL(req.url, API_ORIGIN), { method: req.method, headers, body, redirect: "manual" });
    const out = {};
    upstream.headers.forEach((v, k) => {
      if (!HOP.has(k) && k !== "content-encoding" && k !== "set-cookie") out[k] = v;
    });
    // Each cookie must stay its own header: merging them breaks sign-in.
    const cookies = upstream.headers.getSetCookie();
    if (cookies.length > 0) out["set-cookie"] = cookies;
    res.writeHead(upstream.status, out);
    res.end(Buffer.from(await upstream.arrayBuffer()));
  } catch (err) {
    console.error("proxy error:", err);
    res.writeHead(502, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { code: "bad_gateway", message: "API unreachable" } }));
  }
}

const SECURITY = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-frame-options": "DENY",
  "strict-transport-security": "max-age=31536000; includeSubDomains",
};

function serveFile(res, path, status = 200) {
  const type = MIME[extname(path)] ?? "application/octet-stream";
  // Hashed Vite assets are immutable; index.html must never be cached or
  // clients pin to a stale bundle after a deploy.
  const cache = path.endsWith("index.html") ? "no-cache" : path.includes("/assets/") ? "public, max-age=31536000, immutable" : "public, max-age=3600";
  res.writeHead(status, { "content-type": type, "cache-control": cache, ...SECURITY });
  createReadStream(path).pipe(res);
}

createServer(async (req, res) => {
  if (req.url === "/healthz") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
    return;
  }

  if (req.url === "/v1" || req.url?.startsWith("/v1/")) {
    await proxy(req, res);
    return;
  }

  // normalize + the DIST prefix check together stop ../ path traversal.
  const urlPath = (req.url ?? "/").split("?")[0];
  let candidate;
  try {
    candidate = normalize(join(DIST, decodeURIComponent(urlPath)));
  } catch {
    res.writeHead(400);
    res.end();
    return;
  }
  if (candidate.startsWith(DIST) && existsSync(candidate) && statSync(candidate).isFile()) {
    serveFile(res, candidate);
    return;
  }

  // SPA fallback: unknown paths are client-side routes, so hand back
  // index.html and let the router resolve them.
  serveFile(res, join(DIST, "index.html"));
}).listen(PORT, "::", () => {
  console.log(`web listening on :${PORT}, proxying /v1 -> ${API_ORIGIN ?? "(unset)"}`);
});
