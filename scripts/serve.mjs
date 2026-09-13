import { createServer } from "node:http";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MIME_TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".gif", "image/gif"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".webp", "image/webp"],
]);

function contentTypeFor(filePath) {
  return (
    MIME_TYPES.get(path.extname(filePath).toLowerCase()) ??
    "application/octet-stream"
  );
}

function resolveStaticPath(rootDirectory, requestUrl) {
  let pathname;

  try {
    pathname = decodeURIComponent(requestUrl.split("?", 1)[0]);
  } catch {
    return { statusCode: 400 };
  }

  if (pathname.includes("\0")) {
    return { statusCode: 400 };
  }

  const relativePath = pathname === "/" ? "index.html" : pathname.slice(1);
  const segments = relativePath.split("/");
  if (segments.some((segment) => segment === "..")) {
    return { statusCode: 404 };
  }

  const rootPath = path.resolve(rootDirectory);
  const filePath = path.resolve(rootPath, relativePath);
  if (filePath !== rootPath && !filePath.startsWith(`${rootPath}${path.sep}`)) {
    return { statusCode: 404 };
  }

  return { filePath };
}

async function serveStaticFile(rootDirectory, requestUrl, response) {
  const resolvedPath = resolveStaticPath(rootDirectory, requestUrl);
  if (resolvedPath.statusCode) {
    response.writeHead(resolvedPath.statusCode).end();
    return;
  }

  try {
    const details = await lstat(resolvedPath.filePath);
    if (!details.isFile() || details.isSymbolicLink()) {
      response.writeHead(404).end();
      return;
    }

    const body = await readFile(resolvedPath.filePath);
    response.writeHead(200, {
      "Content-Type": contentTypeFor(resolvedPath.filePath),
    });
    response.end(body);
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") {
      response.writeHead(404).end();
      return;
    }

    response.writeHead(500).end();
  }
}

export function startServer({ rootDirectory, port, host }) {
  const server = createServer((request, response) => {
    void serveStaticFile(rootDirectory, request.url ?? "/", response);
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve({ address: server.address(), server });
    });
  });
}

export async function startProductionServer({
  host = "0.0.0.0",
  onClose = () => {},
  port = 4173,
  rootDirectory,
  signals = process,
}) {
  const startedServer = await startServer({ host, port, rootDirectory });
  const close = () => startedServer.server.close(onClose);

  signals.once("SIGINT", close);
  signals.once("SIGTERM", close);
  return startedServer;
}

const isMainModule =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isMainModule) {
  const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
  const rootDirectory = path.resolve(scriptDirectory, "..", "dist");
  const port = Number.parseInt(process.env.PORT || "4173", 10);
  const startedServer = await startProductionServer({
    port: Number.isNaN(port) ? 4173 : port,
    rootDirectory,
    onClose: () => process.exit(0),
  });

  console.log(`Serving static files on port ${startedServer.address.port}`);
}
