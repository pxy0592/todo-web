import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { after, afterEach, before, test } from "node:test";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";

import {
  getProductionServerOptions,
  startProductionServer,
  startServer,
} from "../scripts/serve.mjs";

let fixtureDirectory;
let outsideDirectory;
let server;
let address;

function request(pathname) {
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        host: "127.0.0.1",
        path: pathname,
        port: address.port,
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          resolve({
            body: Buffer.concat(chunks).toString("utf8"),
            headers: response.headers,
            statusCode: response.statusCode,
          });
        });
      },
    );

    request.on("error", reject);
    request.end();
  });
}

function close(serverToClose) {
  return new Promise((resolve, reject) => {
    serverToClose.close((error) => (error ? reject(error) : resolve()));
  });
}

before(async () => {
  fixtureDirectory = await mkdtemp(
    path.join(os.tmpdir(), "todo-static-server-"),
  );
  outsideDirectory = await mkdtemp(
    path.join(os.tmpdir(), "todo-static-server-outside-"),
  );
  await mkdir(path.join(fixtureDirectory, "assets"));
  await mkdir(path.join(fixtureDirectory, "private"));
  await writeFile(path.join(fixtureDirectory, "index.html"), "<h1>Todo</h1>");
  await writeFile(path.join(fixtureDirectory, "assets", "app.css"), "body {}");
  await writeFile(
    path.join(fixtureDirectory, "assets", "app.js"),
    "export {};",
  );
  await writeFile(path.join(fixtureDirectory, "spaced name.txt"), "decoded");
  await writeFile(
    path.join(fixtureDirectory, "private", "hidden.txt"),
    "private",
  );
  await symlink(
    path.join(fixtureDirectory, "index.html"),
    path.join(fixtureDirectory, "linked.html"),
  );
  await writeFile(path.join(outsideDirectory, "secret.txt"), "outside secret");
  await symlink(
    outsideDirectory,
    path.join(fixtureDirectory, "escaped-directory"),
    "dir",
  );

  ({ address, server } = await startServer({
    host: "127.0.0.1",
    port: 0,
    rootDirectory: fixtureDirectory,
  }));
});

afterEach(() => assert.equal(server.listening, true));

after(async () => {
  await close(server);
  await rm(fixtureDirectory, { force: true, recursive: true });
  await rm(outsideDirectory, { force: true, recursive: true });
});

test("serves index.html for the root request", async () => {
  const response = await request("/");

  assert.equal(response.statusCode, 200);
  assert.match(response.headers["content-type"], /text\/html/);
  assert.equal(response.body, "<h1>Todo</h1>");
});

test("serves CSS and JavaScript with their MIME types", async () => {
  const cssResponse = await request("/assets/app.css");
  const jsResponse = await request("/assets/app.js");

  assert.equal(cssResponse.statusCode, 200);
  assert.match(cssResponse.headers["content-type"], /text\/css/);
  assert.equal(jsResponse.statusCode, 200);
  assert.match(
    jsResponse.headers["content-type"],
    /(?:text|application)\/javascript/,
  );
});

test("decodes URL paths before serving files", async () => {
  const response = await request("/spaced%20name.txt");

  assert.equal(response.statusCode, 200);
  assert.equal(response.body, "decoded");
});

test("rejects missing and traversal-shaped paths", async () => {
  assert.equal((await request("/missing")).statusCode, 404);
  assert.equal((await request("/../package.json")).statusCode, 404);
  assert.equal((await request("/%2e%2e%2fpackage.json")).statusCode, 404);
});

test("rejects a path that resolves outside the static root", async () => {
  const response = await request(`//${outsideDirectory.slice(1)}/secret.txt`);

  assert.equal(response.statusCode, 404);
  assert.doesNotMatch(response.body, /outside secret/);
});

test("rejects null bytes without exposing a filesystem error", async () => {
  const response = await request("/%00secret.txt");

  assert.equal(response.statusCode, 400);
  assert.doesNotMatch(response.body, new RegExp(fixtureDirectory));
});

test("does not list directories or serve symbolic links", async () => {
  const directoryResponse = await request("/private/");
  const linkResponse = await request("/linked.html");

  assert.equal(directoryResponse.statusCode, 404);
  assert.doesNotMatch(directoryResponse.body, /hidden\.txt/);
  assert.equal(linkResponse.statusCode, 404);
});

test("rejects an intermediate symlink directory that escapes the static root", async () => {
  const response = await request("/escaped-directory/secret.txt");

  assert.equal(response.statusCode, 404);
  assert.doesNotMatch(response.body, /outside secret/);
  assert.doesNotMatch(response.body, new RegExp(outsideDirectory));
});

test("closes a started server cleanly", async () => {
  const temporaryServer = await startServer({
    host: "127.0.0.1",
    port: 0,
    rootDirectory: fixtureDirectory,
  });

  await close(temporaryServer.server);

  assert.equal(temporaryServer.server.listening, false);
});

test("uses the container host, port, and sibling dist directory by default", () => {
  const options = getProductionServerOptions({
    environment: {},
    scriptUrl: "file:///app/serve.mjs",
  });

  assert.deepEqual(options, {
    host: "0.0.0.0",
    port: 4173,
    rootDirectory: "/app/dist",
  });
});

test("closes the production server on SIGTERM", async () => {
  const signals = new EventEmitter();
  let closed = false;
  const temporaryServer = await startProductionServer({
    host: "127.0.0.1",
    onClose: () => {
      closed = true;
    },
    port: 0,
    rootDirectory: fixtureDirectory,
    signals,
  });

  const closedServer = new Promise((resolve) => {
    temporaryServer.server.once("close", resolve);
  });
  signals.emit("SIGTERM");
  await closedServer;

  assert.equal(closed, true);
  assert.equal(temporaryServer.server.listening, false);
});

test("closes the production server on SIGINT", async () => {
  const signals = new EventEmitter();
  let closed = false;
  const temporaryServer = await startProductionServer({
    host: "127.0.0.1",
    onClose: () => {
      closed = true;
    },
    port: 0,
    rootDirectory: fixtureDirectory,
    signals,
  });

  const closedServer = new Promise((resolve) => {
    temporaryServer.server.once("close", resolve);
  });
  signals.emit("SIGINT");
  await closedServer;

  assert.equal(closed, true);
  assert.equal(temporaryServer.server.listening, false);
});

test("returns 400 for malformed URL encoding and uses the fallback MIME type", async () => {
  const malformedResponse = await request("/%E0%A4%A");
  const unknownResponse = await request("/spaced%20name.txt");

  assert.equal(malformedResponse.statusCode, 400);
  assert.equal(
    unknownResponse.headers["content-type"],
    "application/octet-stream",
  );
});

test("rejects decoded traversal before it can reach a file in the root", async () => {
  const response = await request("/%2e%2e/private/hidden.txt");

  assert.equal(response.statusCode, 404);
});
