import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { validateStaticContainerContracts } from "../scripts/validate-container.mjs";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

async function createFixture() {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "todo-container-contract-"),
  );

  await Promise.all(
    ["Dockerfile", ".dockerignore", "compose.yaml"].map(async (fileName) => {
      await cp(path.join(projectRoot, fileName), path.join(root, fileName));
    }),
  );

  return root;
}

test("validates the checked-in Dockerfile, Docker ignore, and Compose contracts", async () => {
  const result = await validateStaticContainerContracts(projectRoot);

  assert.deepEqual(result, { ok: true, errors: [] });
});

test("reports a missing static delivery input without throwing", async () => {
  const root = await createFixture();

  try {
    await rm(path.join(root, "Dockerfile"));

    const result = await validateStaticContainerContracts(root);

    assert.deepEqual(result, { ok: false, errors: ["missing-dockerfile"] });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects a Dockerfile that weakens the required runtime contracts", async () => {
  const root = await createFixture();

  try {
    const dockerfilePath = path.join(root, "Dockerfile");
    const source = await readFile(dockerfilePath, "utf8");
    await writeFile(
      dockerfilePath,
      source.replace("USER node", "USER root").replace("EXPOSE 4173", ""),
    );

    const result = await validateStaticContainerContracts(root);

    assert.equal(result.ok, false);
    assert.deepEqual(result.errors, ["dockerfile-runtime-contract"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects ignored-context and Compose service scope regressions", async () => {
  const root = await createFixture();

  try {
    await writeFile(path.join(root, ".dockerignore"), ".git/\nnode_modules/\n");
    await writeFile(
      path.join(root, "compose.yaml"),
      `services:\n  todo-web:\n    build: .\n    image: todo-web:local\n    ports: ["4173:4173"]\n    volumes: [".:/app"]\n  extra:\n    image: busybox\n`,
    );

    const result = await validateStaticContainerContracts(root);

    assert.deepEqual(result, {
      ok: false,
      errors: ["dockerignore-contract", "compose-contract"],
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("runs the canonical workflow, build, image, and Compose smoke command graph", async () => {
  const calls = [];
  const runCommand = async (command, arguments_, options) => {
    calls.push({ arguments_, command, options });
  };

  const { runContainerValidation } =
    await import("../scripts/validate-container.mjs");
  await runContainerValidation({
    isDockerAvailable: async () => true,
    runCommand,
  });

  assert.deepEqual(
    calls.map(({ arguments_, command }) => [command, arguments_]),
    [
      [process.execPath, ["scripts/validate-container-workflow.mjs"]],
      ["docker", ["build", "-t", "todo-web:local", "."]],
      ["docker", ["compose", "config"]],
      ["docker", ["compose", "config"]],
      ["sh", ["scripts/container-smoke.sh"]],
      ["sh", ["scripts/container-smoke.sh"]],
    ],
  );
  assert.equal(calls[3].options.env.TODO_WEB_PORT, "4317");
  assert.match(calls[4].options.env.TODO_WEB_SMOKE_PORT, /^4\d{4}$/);
  assert.equal(calls[5].options.env.TODO_WEB_SMOKE_MODE, "compose");
  assert.match(
    calls[5].options.env.TODO_WEB_COMPOSE_PROJECT,
    /^todo-web-validate-/,
  );
  assert.match(calls[5].options.env.TODO_WEB_COMPOSE_OVERRIDE_PORT, /^4\d{4}$/);
});

test("fails clearly rather than skipping runtime validation when Docker is unavailable", async () => {
  const { runContainerValidation } =
    await import("../scripts/validate-container.mjs");

  await assert.rejects(
    runContainerValidation({
      isDockerAvailable: async () => false,
      runCommand: async () => {},
    }),
    /Docker unavailable: runtime container validation requires a reachable Docker Engine and Docker Compose\./,
  );
});

test("reports an unavailable Docker command as unavailable", async () => {
  const { dockerIsAvailable } =
    await import("../scripts/validate-container.mjs");

  assert.equal(
    await dockerIsAvailable(async () => {
      throw new Error("Docker command unavailable");
    }),
    false,
  );
});

test("runs commands with failure-aware child-process wrappers", async () => {
  const { run } = await import("../scripts/validate-container.mjs");

  await run(process.execPath, ["--version"]);
  await assert.rejects(
    run(process.execPath, ["-e", "process.exit(1)"], { stdio: "ignore" }),
    /failed/,
  );
});

test("handles invalid Compose YAML and reports every missing static input", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "todo-container-invalid-"));

  try {
    await writeFile(path.join(root, "compose.yaml"), "services: [");
    const result = await validateStaticContainerContracts(root);

    assert.deepEqual(result, {
      ok: false,
      errors: [
        "missing-dockerfile",
        "missing-dockerignore",
        "compose-contract",
      ],
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("returns a failed CLI result for invalid static contracts", async () => {
  const root = await createFixture();
  const { main } = await import("../scripts/validate-container.mjs");

  try {
    await rm(path.join(root, "compose.yaml"));
    assert.equal(await main({ root, runCommand: async () => {} }), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("checks Docker Engine and Compose through the default command wrapper", async () => {
  const { dockerIsAvailable } =
    await import("../scripts/validate-container.mjs");

  assert.equal(await dockerIsAvailable(), true);
});

test("keeps Node container tests out of the Playwright browser suite", async () => {
  const config = await readFile(
    path.join(projectRoot, "playwright.config.js"),
    "utf8",
  );

  assert.match(config, /"\*\*\/container-\*\.test\.js"/);
  assert.match(config, /"\*\*\/compose-\*\.test\.js"/);
});
