import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

function readComposeConfig(environment = {}) {
  const result = spawnSync(
    "docker",
    ["compose", "config", "--format", "json"],
    {
      cwd: projectRoot,
      encoding: "utf8",
      env: { ...process.env, ...environment },
    },
  );

  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

function assertTodoWebService(config, publishedPort) {
  assert.deepEqual(Object.keys(config.services), ["todo-web"]);

  const service = config.services["todo-web"];
  assert.equal(path.resolve(service.build.context), projectRoot);
  assert.equal(service.build.dockerfile, "Dockerfile");
  assert.equal(service.image, "todo-web:local");
  assert.deepEqual(service.ports, [
    {
      mode: "ingress",
      target: 4173,
      published: String(publishedPort),
      protocol: "tcp",
    },
  ]);
  assert.equal(service.volumes, undefined);
}

test("renders the default single-service Compose runtime contract", () => {
  assertTodoWebService(readComposeConfig(), 4173);
});

test("renders TODO_WEB_PORT as the published HTTP port", () => {
  assertTodoWebService(readComposeConfig({ TODO_WEB_PORT: "4317" }), 4317);
});
