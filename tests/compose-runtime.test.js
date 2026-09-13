import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const helperPath = path.join(projectRoot, "scripts", "container-smoke.sh");
const packagePath = path.join(projectRoot, "package.json");
const projectName = `todo-web-task6-${process.pid}-${Date.now().toString(36)}`;
const overridePort = "4317";
const containerSmokeTestPath = path.join(
  projectRoot,
  "tests",
  "container-smoke.test.js",
);

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

test("keeps Compose lifecycle checks separate from ordinary unit coverage", () => {
  const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));

  assert.equal(
    packageJson.scripts["test:compose-runtime"],
    "node --test tests/compose-runtime.test.js",
  );
  assert.equal(
    packageJson.scripts["test:unit"].includes("compose-runtime"),
    false,
  );
  assert.equal(
    packageJson.scripts["test:coverage"].includes("compose-runtime"),
    false,
  );
});

test("uses distinct dynamic ports for independent Docker runtime smoke tests", () => {
  const containerSmokeTest = readFileSync(containerSmokeTestPath, "utf8");

  assert.match(containerSmokeTest, /TODO_WEB_SMOKE_PORT/);
  assert.match(containerSmokeTest, /const smokePort = "0"/);
});

test("uses an unset default Compose environment with a temporary port override and bounded curl", () => {
  const smokeScript = readFileSync(helperPath, "utf8");

  assert.match(smokeScript, /TODO_WEB_COMPOSE_DEFAULT_PORT_OVERRIDE/);
  assert.match(smokeScript, /ports: !override/);
  assert.match(smokeScript, /compose port todo-web 4173/);
  assert.match(
    smokeScript,
    /unset TODO_WEB_PORT[\s\S]*compose_with_default_port_override up --build -d/,
  );
  assert.doesNotMatch(
    smokeScript,
    /TODO_WEB_PORT="\$compose_port" compose up --build -d/,
  );
  assert.match(
    smokeScript,
    /curl --connect-timeout "\$curl_connect_timeout" --max-time "\$curl_max_time"/,
  );
  assert.match(
    smokeScript,
    /unset TODO_WEB_PORT\n {4}compose_with_default_port_override up --build -d[\s\S]*compose_started=1/,
  );
  assert.match(
    smokeScript,
    /compose_started=1\n {2}TODO_WEB_PORT="\$compose_override_port" compose up --build -d/,
  );
});

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
          TODO_WEB_COMPOSE_OVERRIDE_PORT: overridePort,
          TODO_WEB_PORT: "49999",
        },
      });

      assert.equal(result.error, undefined);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /Compose lifecycle smoke checks passed/);
      assert.match(result.stdout, new RegExp(`TODO_WEB_PORT=${overridePort}`));
      assert.equal(compose(["ps", "-q"]).trim(), "");
    } finally {
      const cleanup = spawnSync(
        "docker",
        ["compose", "--project-name", projectName, "down"],
        { cwd: projectRoot, stdio: "ignore" },
      );
      assert.equal(cleanup.status, 0, cleanup.stderr);
    }
  },
);
