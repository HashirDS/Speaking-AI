const { createReadStream, existsSync, statSync } = require("node:fs");
const { createServer } = require("node:http");
const { extname, normalize, resolve, sep } = require("node:path");

const root = resolve(__dirname, "..");
const preferredPort = Number(process.argv[2] || process.env.PORT || 4173);
const securityHeaders = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "microphone=(self)",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Content-Security-Policy": "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'",
};
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".webmanifest": "application/manifest+json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png" };

function handleRequest(request, response) {
  if (!["GET", "HEAD"].includes(request.method || "GET")) return response.writeHead(405, { Allow: "GET, HEAD" }).end("Method Not Allowed");
  const url = new URL(request.url || "/", "http://localhost");
  let requested;
  try { requested = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname); } catch { return response.writeHead(400).end("Bad Request"); }
  const candidate = resolve(root, `.${normalize(requested)}`);
  if (candidate !== root && !candidate.startsWith(`${root}${sep}`)) return response.writeHead(403).end("Forbidden");
  const file = existsSync(candidate) && statSync(candidate).isFile() ? candidate : resolve(root, "index.html");
  response.writeHead(200, { "Content-Type": types[extname(file)] || "application/octet-stream", "Cache-Control": extname(file) === ".html" ? "no-cache" : "public, max-age=300", ...securityHeaders });
  if (request.method === "HEAD") return response.end();
  createReadStream(file).pipe(response);
}

function startServer(port = preferredPort, attempts = 0) {
  const server = createServer(handleRequest);
  server.once("error", (error) => {
    if (error.code === "EADDRINUSE" && attempts < 20) return startServer(port + 1, attempts + 1);
    console.error(`Could not start Luma: ${error.message}`);
    process.exitCode = 1;
  });
  server.listen(port, "127.0.0.1", () => console.log(`Luma IELTS coach is running at http://127.0.0.1:${port}`));
}

startServer();