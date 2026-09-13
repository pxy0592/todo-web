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
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run build
      - uses: actions/upload-artifact@v4
        with:
          name: todo-web-dist-\${{ github.sha }}
          path: dist/
          if-no-files-found: error
  test:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - run: npm run format:check
      - run: npm run lint
      - run: npm run test:unit
      - run: npm run test:coverage
      - run: npm run test:e2e
      - run: npm run build
  image:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - uses: docker/metadata-action@v5
        id: meta
        with:
          images: ghcr.io/\${{ github.repository }}
          tags: |
            type=sha,format=long,prefix=sha-
            type=raw,value=latest,enable=\${{ github.event_name == 'push' && github.ref == 'refs/heads/main' }}
      - uses: docker/build-push-action@v6
        with:
          context: .
          file: ./Dockerfile
          tags: \${{ steps.meta.outputs.tags }}
          labels: \${{ steps.meta.outputs.labels }}
          outputs: type=docker,dest=/tmp/todo-web-image.tar
          push: false
      - uses: actions/upload-artifact@v4
        with:
          name: todo-web-image-\${{ github.sha }}
          path: /tmp/todo-web-image.tar
          if-no-files-found: error
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

test("requires build steps that create a retained dist artifact", () => {
  for (const [from, to] of [
    ["actions/checkout@v4", "actions/checkout@v3"],
    ["node-version: 22", "node-version: 20"],
    ["cache: npm", "cache: yarn"],
    ["      - run: npm ci\n", ""],
    [
      "      - run: npm run build\n      - uses: actions/upload-artifact@v4",
      "      - uses: actions/upload-artifact@v4",
    ],
    ["actions/upload-artifact@v4", "actions/upload-artifact@v3"],
    ["path: dist/", "path: build/"],
    ["if-no-files-found: error", "if-no-files-found: warn"],
  ]) {
    assertRejected(workflowWith({ from, to }), "build-job-steps");
  }
});

test("requires all existing verification gates after a successful build", () => {
  for (const command of [
    "npm ci",
    "npx playwright install --with-deps chromium",
    "npm run format:check",
    "npm run lint",
    "npm run test:unit",
    "npm run test:coverage",
    "npm run test:e2e",
    "npm run build",
  ]) {
    const testJobStart = validWorkflow.indexOf("  test:\n");
    const commandStart = validWorkflow.indexOf(
      `      - run: ${command}\n`,
      testJobStart,
    );
    const nextJobStart = validWorkflow.indexOf("  image:\n", testJobStart);

    assert.ok(commandStart >= testJobStart && commandStart < nextJobStart);
    assertRejected(
      validWorkflow.slice(0, commandStart) +
        validWorkflow.slice(commandStart + `      - run: ${command}\n`.length),
      "test-job-steps",
    );
  }

  const testJobStart = validWorkflow.indexOf("  test:\n");
  const testJobEnd = validWorkflow.indexOf("  image:\n", testJobStart);
  const testJob = validWorkflow.slice(testJobStart, testJobEnd);

  for (const [from, to] of [
    [
      "      - uses: actions/checkout@v4\n      - uses: actions/setup-node@v4",
      "      - uses: actions/setup-node@v4",
    ],
    ["node-version: 22", "node-version: 20"],
    ["cache: npm", "cache: yarn"],
  ]) {
    assert.ok(testJob.includes(from));
    assertRejected(
      validWorkflow.slice(0, testJobStart) +
        testJob.replace(from, to) +
        validWorkflow.slice(testJobEnd),
      "test-job-steps",
    );
  }
});

function workflowWithImage({ from, to }) {
  const imageJobStart = validWorkflow.indexOf("  image:\n");
  const imageJobEnd = validWorkflow.indexOf("  publish:\n", imageJobStart);
  const imageJob = validWorkflow.slice(imageJobStart, imageJobEnd);

  assert.ok(imageJob.includes(from), `missing image fixture text: ${from}`);
  return (
    validWorkflow.slice(0, imageJobStart) +
    imageJob.replace(from, to) +
    validWorkflow.slice(imageJobEnd)
  );
}

function workflowWithPublish({ from, to }) {
  const publishJobStart = validWorkflow.indexOf("  publish:\n");
  const publishJob = validWorkflow.slice(publishJobStart);

  assert.ok(publishJob.includes(from), `missing publish fixture text: ${from}`);
  return validWorkflow.slice(0, publishJobStart) + publishJob.replace(from, to);
}

test("requires an uncredentialed Buildx image artifact job with traceable metadata", () => {
  for (const [from, to] of [
    ["docker/setup-buildx-action@v3", "docker/setup-buildx-action@v2"],
    ["docker/metadata-action@v5", "docker/metadata-action@v4"],
    [
      "images: ghcr.io/${{ github.repository }}",
      "images: ghcr.io/example/todo-web",
    ],
    ["type=sha,format=long,prefix=sha-", "type=sha,format=short,prefix=sha-"],
    [
      "type=raw,value=latest,enable=${{ github.event_name == 'push' && github.ref == 'refs/heads/main' }}",
      "type=raw,value=latest,enable=true",
    ],
    ["file: ./Dockerfile", "file: ./Containerfile"],
    ["tags: ${{ steps.meta.outputs.tags }}", "tags: todo-web:latest"],
    ["labels: ${{ steps.meta.outputs.labels }}", "labels: ignored"],
    [
      "outputs: type=docker,dest=/tmp/todo-web-image.tar",
      "outputs: type=registry",
    ],
    ["push: false", "push: true"],
    ["name: todo-web-image-${{ github.sha }}", "name: todo-web-image"],
    ["path: /tmp/todo-web-image.tar", "path: /tmp/image.tar"],
  ]) {
    assertRejected(workflowWithImage({ from, to }), "image-job-steps");
  }

  assertRejected(
    workflowWithImage({
      from: "      - uses: docker/setup-buildx-action@v3\n",
      to: "",
    }),
    "image-job-steps",
  );
});

test("requires image artifact uploads to fail when no tarball is exported", () => {
  const imageArtifactStart = validWorkflow.indexOf(
    "          name: todo-web-image-${{ github.sha }}",
  );
  const imageArtifactEnd = validWorkflow.indexOf(
    "  publish:\n",
    imageArtifactStart,
  );
  const imageArtifact = validWorkflow.slice(
    imageArtifactStart,
    imageArtifactEnd,
  );

  assert.ok(imageArtifact.includes("if-no-files-found: error"));
  assertRejected(
    validWorkflow.slice(0, imageArtifactStart) +
      imageArtifact.replace(
        "if-no-files-found: error",
        "if-no-files-found: warn",
      ) +
      validWorkflow.slice(imageArtifactEnd),
    "image-job-steps",
  );
});

test("rejects registry login and direct image push steps", () => {
  for (const [from, to] of [
    [
      "      - uses: docker/setup-buildx-action@v3",
      "      - uses: docker/login-action@v3\n        with:\n          registry: ghcr.io\n      - uses: docker/setup-buildx-action@v3",
    ],
    [
      "      - uses: docker/setup-buildx-action@v3",
      "      - uses: docker/login-action@v4\n        with:\n          registry: ghcr.io\n      - uses: docker/setup-buildx-action@v3",
    ],
    [
      "      - uses: docker/setup-buildx-action@v3",
      "      - uses: docker/setup-buildx-action@v3\n      - run: docker login ghcr.io",
    ],
    [
      "          push: false",
      "          push: false\n      - run: docker push ghcr.io/example/todo-web:latest",
    ],
  ]) {
    assertRejected(workflowWithImage({ from, to }), "image-job-steps");
  }
});

test("requires the exact serial needs graph so prerequisite failures block later jobs", () => {
  for (const [from, to] of [
    ["    needs: build\n    runs-on", "    runs-on"],
    ["    needs: test\n    runs-on", "    runs-on"],
    ["    needs: image\n    if:", "    if:"],
  ]) {
    assertRejected(workflowWith({ from, to }), "job-needs");
  }
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
  const imageJobStart = validWorkflow.indexOf("  image:\n");
  const imageJobEnd = validWorkflow.indexOf("  publish:\n", imageJobStart);
  const workflowWithoutImage =
    validWorkflow.slice(0, imageJobStart) + validWorkflow.slice(imageJobEnd);

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
  const workflowWithParenthesizedGuard = workflowWithPublish({
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
      workflowWithPublish({
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
    from: "  build:\n    runs-on",
    to: "  build:\n    permissions:\n      contents: read\n    runs-on",
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
      workflowWith({
        from: "  build:\n    runs-on",
        to: replacement + "\n    runs-on",
      }),
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
