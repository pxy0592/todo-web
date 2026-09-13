import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const containerName = "todo-web-smoke";
const helperPath = path.join(projectRoot, "scripts", "container-smoke.sh");
const smokePort = "0";

function removeSmokeContainer() {
  execFileSync("docker", ["rm", "-f", containerName], {
    cwd: projectRoot,
    stdio: "ignore",
  });
}

test("validates the local image HTTP contract and cleans up its named container", () => {
  try {
    const result = spawnSync(helperPath, [], {
      cwd: projectRoot,
      encoding: "utf8",
      env: { ...process.env, TODO_WEB_SMOKE_PORT: smokePort },
    });

    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Container smoke checks passed/);

    const containers = execFileSync(
      "docker",
      ["ps", "-aq", "--filter", `name=^/${containerName}$`],
      { cwd: projectRoot, encoding: "utf8" },
    );
    assert.equal(containers.trim(), "");
  } finally {
    removeSmokeContainer();
  }
});
