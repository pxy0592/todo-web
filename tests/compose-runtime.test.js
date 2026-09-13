import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const helperPath = path.join(projectRoot, "scripts", "container-smoke.sh");
const projectName = `todo-web-task6-${process.pid}-${Date.now().toString(36)}`;
const composePort = String(41_000 + (process.pid % 1_000) * 2);
const overridePort = String(Number(composePort) + 1);

function compose(arguments_) {
  return execFileSync(
    "docker",
    ["compose", "--project-name", projectName, ...arguments_],
    {
      cwd: projectRoot,
      encoding: "utf8",
    },
  );
}

test(
  "verifies the default and overridden Compose HTTP lifecycle without leaving project resources",
  { timeout: 180_000 },
  () => {
    try {
      const result = spawnSync(helperPath, [], {
        cwd: projectRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          TODO_WEB_COMPOSE_PROJECT: projectName,
          TODO_WEB_SMOKE_MODE: "compose",
          TODO_WEB_COMPOSE_PORT: composePort,
          TODO_WEB_COMPOSE_OVERRIDE_PORT: overridePort,
        },
      });

      assert.equal(result.error, undefined);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /Compose lifecycle smoke checks passed/);
      assert.match(result.stdout, new RegExp(`TODO_WEB_PORT=${overridePort}`));
      assert.equal(compose(["ps", "-q"]).trim(), "");
    } finally {
      compose(["down"]);
    }
  },
);
