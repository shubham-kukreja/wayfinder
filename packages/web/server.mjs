// Static file server + API proxy for the deployed web app.
//
// Two jobs:
//  1. Serve the Vite build with an SPA fallback, so a hard refresh on a
//     client-side route (/reviews, /model/signals) returns index.html
//     rather than 404.
//  2. Proxy /api/* to the API service and attach the x-api-secret header
//     here, server-side. The browser never sees the secret, which is the
//     whole reason this is a Node process and not a static bucket.
//
// API_ORIGIN should be the API service's PRIVATE Railway address
// (http://<service>.railway.internal:<port>) so the API needs no public
// domain at all. A public https:// origin also works.
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const PORT = Number(process.env.PORT) || 8080;
const DIST = join(import.meta.dirname, "dist");
const API_ORIGIN = process.env.API_ORIGIN;
const API_SECRET = process.env.API_SECRET;

if (!API_ORIGIN) {
  console.warn("API_ORIGIN is unset — /api/* requests will 502.");
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

async function proxy(req, res) {
  if (!API_ORIGIN) {
    res.writeHead(502, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "API_ORIGIN not configured" }));
    return;
  }

  // Forward the body for mutating methods. Bodies here are small (params,
  // score edits), so buffering rather than streaming keeps this simple.
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = chunks.length > 0 ? Buffer.concat(chunks) : undefined;

  const headers = { ...req.headers };
  // Host would otherwise point at the web service and confuse the upstream.
  delete headers.host;
  delete headers["content-length"];
  // Inject the secret server-side. Any value the browser tried to send is
  // overwritten, so a client cannot influence authentication.
  if (API_SECRET) headers["x-api-secret"] = API_SECRET;

  try {
    const upstream = await fetch(new URL(req.url, API_ORIGIN), {
      method: req.method,
      headers,
      body,
      redirect: "manual",
    });
    const out = Object.fromEntries(upstream.headers.entries());
    delete out["content-encoding"];
    delete out["content-length"];
    delete out["transfer-encoding"];
    res.writeHead(upstream.status, out);
    res.end(Buffer.from(await upstream.arrayBuffer()));
  } catch (err) {
    console.error("proxy error:", err);
    res.writeHead(502, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "upstream unreachable", detail: String(err) }));
  }
}

function serveFile(res, path, status = 200) {
  const type = MIME[extname(path)] ?? "application/octet-stream";
  // Hashed Vite assets are immutable; index.html must never be cached or
  // clients pin to a stale bundle after a deploy.
  const cache = path.endsWith("index.html")
    ? "no-cache"
    : path.includes("/assets/")
      ? "public, max-age=31536000, immutable"
      : "public, max-age=3600";
  res.writeHead(status, { "content-type": type, "cache-control": cache });
  createReadStream(path).pipe(res);
}

createServer(async (req, res) => {
  if (req.url === "/healthz") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
    return;
  }

  if (req.url?.startsWith("/api/")) {
    await proxy(req, res);
    return;
  }

  // normalize + the DIST prefix check together stop ../ path traversal.
  const urlPath = (req.url ?? "/").split("?")[0];
  const candidate = normalize(join(DIST, decodeURIComponent(urlPath)));
  if (candidate.startsWith(DIST) && existsSync(candidate) && statSync(candidate).isFile()) {
    serveFile(res, candidate);
    return;
  }

  // SPA fallback: unknown paths are client-side routes (/overview,
  // /model/signals, /reviews), so hand back index.html and let the router
  // resolve them.
  serveFile(res, join(DIST, "index.html"));
}).listen(PORT, "0.0.0.0", () => {
  console.log(`web listening on 0.0.0.0:${PORT}, proxying /api -> ${API_ORIGIN ?? "(unset)"}`);
});
