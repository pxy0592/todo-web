import { createServer } from "node:http";
import { lstat, readFile, realpath } from "node:fs/promises";
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

function isWithin(rootPath, filePath) {
  return filePath === rootPath || filePath.startsWith(`${rootPath}${path.sep}`);
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

    const [rootPath, filePath] = await Promise.all([
      realpath(rootDirectory),
      realpath(resolvedPath.filePath),
    ]);
    if (!isWithin(rootPath, filePath)) {
      response.writeHead(404).end();
      return;
    }

    const body = await readFile(filePath);
    response.writeHead(200, {
      "Content-Type": contentTypeFor(filePath),
    });
    response.end(body);
  } catch {
    response.writeHead(404).end();
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

export function getProductionServerOptions({
  environment = process.env,
  scriptUrl = import.meta.url,
} = {}) {
  const configuredPort = Number.parseInt(environment.PORT || "4173", 10);

  return {
    host: "0.0.0.0",
    port: Number.isNaN(configuredPort) ? 4173 : configuredPort,
    rootDirectory: path.resolve(path.dirname(fileURLToPath(scriptUrl)), "dist"),
  };
}

export async function startProductionServer({
  host = "0.0.0.0",
  onClose,
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
  const startedServer = await startProductionServer({
    ...getProductionServerOptions(),
    onClose: process.exit.bind(process, 0),
  });

  console.log(`Serving static files on port ${startedServer.address.port}`);
}
