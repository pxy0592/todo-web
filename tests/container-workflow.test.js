import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { test } from "node:test";
import {
  parseWorkflow,
  validateWorkflow,
} from "../scripts/validate-container-workflow.mjs";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const validatorPath = path.join(
  projectRoot,
  "scripts",
  "validate-container-workflow.mjs",
);

const validWorkflow = `
name: Container delivery

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

permissions:
  contents: read

jobs:
  build: {}
  test:
    needs: build
  image:
    needs: test
  publish:
    needs: image
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    permissions:
      contents: read
      packages: write
`;

function workflowWith({ from, to }) {
  assert.ok(validWorkflow.includes(from), `missing fixture text: ${from}`);
  return validWorkflow.replace(from, to);
}

function resultFor(source) {
  return validateWorkflow(parseWorkflow(source));
}

function assertRejected(source, error) {
  const result = resultFor(source);

  assert.equal(result.ok, false);
  assert.ok(result.errors.includes(error));
}

test("accepts the checked-in workflow", () => {
  assert.deepEqual(resultFor(validWorkflow), { ok: true });
});

test("requires the build to test to image to publish chain", () => {
  const workflowWithoutPublishNeed = workflowWith({
    from: "    needs: image\n    if:",
    to: "    if:",
  });

  assertRejected(workflowWithoutPublishNeed, "job-needs");
});

test("rejects additional needs outside the exact chain", () => {
  const workflowWithExtraPublishNeed = workflowWith({
    from: "    needs: image\n    if:",
    to: "    needs: [image, test]\n    if:",
  });

  assertRejected(workflowWithExtraPublishNeed, "job-needs");
});

test("requires all four named jobs", () => {
  const workflowWithoutImage = workflowWith({
    from: "  image:\n    needs: test\n",
    to: "",
  });

  assertRejected(workflowWithoutImage, "required-jobs");
});

test("requires main push and pull request triggers", () => {
  const workflowWithoutPullRequest = workflowWith({
    from: "  pull_request:\n    branches: [main]\n",
    to: "",
  });
  const workflowWithoutPushMain = workflowWith({
    from: "    branches: [main]",
    to: "    branches: [release]",
  });

  assertRejected(workflowWithoutPullRequest, "main-triggers");
  assertRejected(workflowWithoutPushMain, "main-triggers");
});

test("accepts the canonical publish guard with whitespace and parentheses", () => {
  const workflowWithParenthesizedGuard = workflowWith({
    from: "github.event_name == 'push' && github.ref == 'refs/heads/main'",
    to: " ( github.event_name == 'push' ) && (( github.ref == 'refs/heads/main' )) ",
  });

  assert.deepEqual(resultFor(workflowWithParenthesizedGuard), { ok: true });
});

test("rejects non-canonical publish guards", () => {
  for (const condition of [
    "github.event_name == 'push' || github.ref == 'refs/heads/main'",
    "github.event_name == 'push' && github.ref == 'refs/heads/main' && github.actor == 'owner'",
    "!github.event_name == 'push' && github.ref == 'refs/heads/main'",
    "github.ref == 'refs/heads/main' && github.event_name == 'push'",
    "github.event_name == 'push' && github.ref == 'refs/heads/release'",
    "(github.event_name == 'push' && github.ref == 'refs/heads/main'(",
  ]) {
    assertRejected(
      workflowWith({
        from: "github.event_name == 'push' && github.ref == 'refs/heads/main'",
        to: condition,
      }),
      "publish-guard",
    );
  }
});

test("requires root permissions to be exactly contents read", () => {
  for (const replacement of [
    "  contents: write",
    "  contents: read\n  packages: none",
    "  contents: read\n  actions: none",
  ]) {
    assertRejected(
      workflowWith({ from: "  contents: read", to: replacement }),
      "contents-permission",
    );
  }
});

test("requires publish permissions to be exactly contents read and packages write", () => {
  for (const replacement of [
    "      packages: read",
    "      packages: write\n      actions: read",
  ]) {
    assertRejected(
      workflowWith({ from: "      packages: write", to: replacement }),
      "package-permissions",
    );
  }

  assertRejected(
    workflowWith({
      from: "      contents: read\n      packages: write",
      to: "      contents: write\n      packages: write",
    }),
    "package-permissions",
  );

  assertRejected(
    workflowWith({
      from: "    permissions:\n      contents: read\n      packages: write\n",
      to: "    permissions:\n      packages: write\n",
    }),
    "package-permissions",
  );
});

test("allows non-publish jobs to restate only their inherited contents read permission", () => {
  const workflowWithReadOnlyBuildPermission = workflowWith({
    from: "  build: {}",
    to: "  build:\n    permissions:\n      contents: read",
  });

  assert.deepEqual(resultFor(workflowWithReadOnlyBuildPermission), {
    ok: true,
  });
});

test("rejects non-publish job permission broadening", () => {
  for (const replacement of [
    "  build:\n    permissions:\n      contents: write",
    "  build:\n    permissions:\n      packages: read",
    "  build:\n    permissions:\n      actions: read",
  ]) {
    assertRejected(
      workflowWith({ from: "  build: {}", to: replacement }),
      "package-permissions",
    );
  }
});

test("allows only GITHUB_TOKEN expressions in password or token contexts", () => {
  const workflowWithAllowedCredentials = workflowWith({
    from: "      packages: write",
    to: `      packages: write
    env:
      GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}
    steps:
      - with:
          password: \${{ secrets.GITHUB_TOKEN }}`,
  });

  assert.deepEqual(resultFor(workflowWithAllowedCredentials), { ok: true });
});

test("rejects hard-coded camelCase credential keys without exposing values", () => {
  const secret = "not-a-real-camel-case-credential";
  const unsafeWorkflows = [
    workflowWith({
      from: "      packages: write",
      to: `      packages: write
    env:
      registryPassword: ${secret}`,
    }),
    workflowWith({
      from: "      packages: write",
      to: `      packages: write
    env:
      accessToken: ${secret}`,
    }),
  ];

  for (const workflow of unsafeWorkflows) {
    const result = resultFor(workflow);

    assert.equal(result.ok, false);
    assert.ok(result.errors.includes("credential-safety"));
    assert.equal(JSON.stringify(result).includes(secret), false);
  }
});

test("rejects PAT and token-shaped credentials without exposing values", () => {
  const secret = "ghp_not-a-real-secret";
  const unsafeWorkflows = [
    workflowWith({
      from: "      packages: write",
      to: `      packages: write
    env:
      PERSONAL_ACCESS_TOKEN: ${secret}`,
    }),
    workflowWith({
      from: "      packages: write",
      to: `      packages: write
    env:
      GH_PAT: ${secret}`,
    }),
    workflowWith({
      from: "      packages: write",
      to: `      packages: write
    env:
      REGISTRY_TOKEN: ordinary-value`,
    }),
    workflowWith({
      from: "      packages: write",
      to: `      packages: write
    steps:
      - with:
          password: \${{ secrets.OTHER_TOKEN }}`,
    }),
    workflowWith({
      from: "      packages: write",
      to: `      packages: write
    steps:
      - with:
          username: \${{ secrets.GITHUB_TOKEN }}`,
    }),
    workflowWith({
      from: "      packages: write",
      to: `      packages: write
    env:
      USERNAME: ghp_not-a-real-secret`,
    }),
    workflowWith({
      from: "      packages: write",
      to: `      packages: write
    env:
      USERNAME: github_pat_not-a-real-secret`,
    }),
  ];

  for (const workflow of unsafeWorkflows) {
    const result = resultFor(workflow);

    assert.equal(result.ok, false);
    assert.ok(result.errors.includes("credential-safety"));
    assert.equal(JSON.stringify(result).includes(secret), false);
  }
});

test("rejects malformed YAML without including source content", () => {
  const malformedSource = "jobs: [not-valid";

  assert.throws(
    () => parseWorkflow(malformedSource),
    /Container workflow YAML could not be parsed/,
  );
});

test("fails closed for malformed on-disk YAML through the CLI", async () => {
  const temporaryDirectory = await mkdtemp(
    path.join(os.tmpdir(), "todo-workflow-"),
  );
  const malformedPath = path.join(temporaryDirectory, "workflow.yml");
  const malformedSource = "jobs: [not-valid";

  try {
    await writeFile(malformedPath, malformedSource);
    const result = spawnSync(process.execPath, [validatorPath, malformedPath], {
      cwd: projectRoot,
      encoding: "utf8",
    });

    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr.trim(), "Container workflow validation failed");
    assert.equal(
      `${result.stdout}${result.stderr}`.includes(malformedSource),
      false,
    );
  } finally {
    await rm(temporaryDirectory, { force: true, recursive: true });
  }
});

test("validates the checked-in workflow through the CLI", () => {
  const result = spawnSync(process.execPath, [validatorPath], {
    cwd: projectRoot,
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "Container workflow validation passed");
  assert.equal(result.stderr, "");
});
