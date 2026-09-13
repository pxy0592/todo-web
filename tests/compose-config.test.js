import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { parse } from "yaml";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

function readComposeSource() {
  return parse(readFileSync(path.join(projectRoot, "compose.yaml"), "utf8"));
}

function readComposeConfig(environmentOverrides = {}) {
  const environment = { ...process.env, ...environmentOverrides };

  for (const [name, value] of Object.entries(environmentOverrides)) {
    if (value === undefined) {
      delete environment[name];
    }
  }

  const result = spawnSync(
    "docker",
    ["compose", "config", "--format", "json"],
    {
      cwd: projectRoot,
      encoding: "utf8",
      env: environment,
    },
  );

  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

function assertComposeSourceContract(config) {
  assert.deepEqual(Object.keys(config.services), ["todo-web"]);
  assert.equal(config.volumes, undefined);
  assert.equal(config.networks, undefined);

  const service = config.services["todo-web"];
  assert.equal(service.volumes, undefined);
  assert.equal(service.networks, undefined);
  assert.equal(service.privileged, undefined);
  assert.equal(service.network_mode, undefined);
}

function assertTodoWebService(config, publishedPort) {
  assert.deepEqual(Object.keys(config.services), ["todo-web"]);
  assert.equal(config.volumes, undefined);

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
  assert.equal(service.privileged, undefined);
  assert.equal(service.network_mode, undefined);
}

test("declares only the unprivileged single-service Compose source contract", () => {
  assertComposeSourceContract(readComposeSource());
});

test("renders the default single-service Compose runtime contract", () => {
  assertTodoWebService(readComposeConfig({ TODO_WEB_PORT: undefined }), 4173);
});

test("renders TODO_WEB_PORT as the published HTTP port", () => {
  assertTodoWebService(readComposeConfig({ TODO_WEB_PORT: "4317" }), 4317);
});
