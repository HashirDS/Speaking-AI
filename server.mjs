import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)));
const preferredPort = Number(process.argv[2] || process.env.PORT || 4173);
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

function handleRequest(request, response) {
  if (!['GET', 'HEAD'].includes(request.method || 'GET')) {
    response.writeHead(405, { Allow: 'GET, HEAD' }).end('Method Not Allowed');
    return;
  }
  const url = new URL(request.url || "/", "http://localhost");
  let requested;
  try {
    requested = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  } catch {
    response.writeHead(400).end("Bad Request");
    return;
  }
  const candidate = resolve(root, `.${normalize(requested)}`);
  if (candidate !== root && !candidate.startsWith(`${root}${sep}`)) {
    response.writeHead(403).end("Forbidden");
    return;
  }
  const file = existsSync(candidate) && statSync(candidate).isFile() ? candidate : resolve(root, "index.html");
  response.writeHead(200, {
    "Content-Type": types[extname(file)] || "application/octet-stream",
    "Cache-Control": extname(file) === ".html" ? "no-cache" : "public, max-age=300",
    "X-Content-Type-Options": "nosniff",
    "Permissions-Policy": "microphone=(self)",
  });
  if (request.method === "HEAD") {
    response.end();
    return;
  }
  const stream = createReadStream(file);
  stream.on("error", () => response.destroy());
  stream.pipe(response);
}

function startServer(port = preferredPort, attempts = 0) {
  const server = createServer(handleRequest);
  server.once("error", (error) => {
    if (error.code === "EADDRINUSE" && attempts < 20) {
      const nextPort = port + 1;
      console.warn(`Port ${port} is already in use. Trying ${nextPort}…`);
      startServer(nextPort, attempts + 1);
      return;
    }
    console.error(`Could not start Luma: ${error.message}`);
    process.exitCode = 1;
  });
  server.listen(port, "127.0.0.1", () => {
    console.log(`Luma IELTS coach is running at http://127.0.0.1:${port}`);
  });
}

startServer();
