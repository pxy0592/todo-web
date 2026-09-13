import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseWorkflow,
  validateWorkflow,
} from "../scripts/validate-container-workflow.mjs";

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

function workflowWith(replacement) {
  return validWorkflow.replace(replacement.from, replacement.to);
}

test("accepts the container workflow dependency foundation", () => {
  assert.deepEqual(validateWorkflow(parseWorkflow(validWorkflow)), {
    ok: true,
  });
});

test("requires the build to test to image to publish chain", () => {
  const workflowWithoutPublishNeed = workflowWith({
    from: "    needs: image\n    if:",
    to: "    if:",
  });

  assert.equal(
    validateWorkflow(parseWorkflow(workflowWithoutPublishNeed)).ok,
    false,
  );
  assert.equal(
    validateWorkflow(
      parseWorkflow(
        workflowWith({ from: "    needs: test", to: "    needs: build" }),
      ),
    ).ok,
    false,
  );
});

test("rejects additional needs outside the exact chain", () => {
  const workflowWithExtraPublishNeed = workflowWith({
    from: "    needs: image\n    if:",
    to: "    needs: [image, test]\n    if:",
  });

  assert.equal(
    validateWorkflow(parseWorkflow(workflowWithExtraPublishNeed)).ok,
    false,
  );
});

test("requires all four named jobs", () => {
  const workflowWithoutImage = workflowWith({
    from: "  image:\n    needs: test\n",
    to: "",
  });

  assert.equal(validateWorkflow(parseWorkflow(workflowWithoutImage)).ok, false);
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

  assert.equal(
    validateWorkflow(parseWorkflow(workflowWithoutPullRequest)).ok,
    false,
  );
  assert.equal(
    validateWorkflow(parseWorkflow(workflowWithoutPushMain)).ok,
    false,
  );
});

test("requires an explicit push and main publish guard", () => {
  const workflowWithUnsafePublishCondition = workflowWith({
    from: "github.event_name == 'push' && github.ref == 'refs/heads/main'",
    to: "github.event_name == 'push'",
  });

  assert.equal(
    validateWorkflow(parseWorkflow(workflowWithUnsafePublishCondition)).ok,
    false,
  );
});

test("requires exactly the four delivery jobs", () => {
  const workflowWithUnexpectedJob = workflowWith({
    from: "  build: {}",
    to: "  cleanup: {}\n  build: {}",
  });

  assert.equal(
    validateWorkflow(parseWorkflow(workflowWithUnexpectedJob)).ok,
    false,
  );
});

test("accepts single-item needs arrays", () => {
  const workflowWithArrayNeeds = validWorkflow
    .replace("needs: build", "needs: [build]")
    .replace("needs: test", "needs: [test]")
    .replace("needs: image", "needs: [image]");

  assert.deepEqual(validateWorkflow(parseWorkflow(workflowWithArrayNeeds)), {
    ok: true,
  });
});

test("requires root contents read permission", () => {
  const workflowWithWriteContents = workflowWith({
    from: "  contents: read",
    to: "  contents: write",
  });

  const workflowWithExtraRootPermission = workflowWith({
    from: "  contents: read\n\njobs:",
    to: "  contents: read\n  actions: write\n\njobs:",
  });

  assert.equal(
    validateWorkflow(parseWorkflow(workflowWithWriteContents)).ok,
    false,
  );
  assert.equal(
    validateWorkflow(parseWorkflow(workflowWithExtraRootPermission)).ok,
    false,
  );
});

test("requires package publishing permission only on the guarded publish job", () => {
  const workflowWithoutPackageWrite = workflowWith({
    from: "      packages: write\n",
    to: "",
  });
  const workflowWithGlobalPackageWrite = workflowWith({
    from: "  contents: read\n\njobs:",
    to: "  contents: read\n  packages: write\n\njobs:",
  });
  const workflowWithBuildPackageWrite = workflowWith({
    from: "  build: {}",
    to: "  build:\n    permissions:\n      packages: write",
  });

  assert.equal(
    validateWorkflow(parseWorkflow(workflowWithoutPackageWrite)).ok,
    false,
  );
  assert.equal(
    validateWorkflow(parseWorkflow(workflowWithGlobalPackageWrite)).ok,
    false,
  );
  assert.equal(
    validateWorkflow(parseWorkflow(workflowWithBuildPackageWrite)).ok,
    false,
  );
});

test("rejects long-lived credentials without exposing their value in errors", () => {
  const secret = "not-a-real-personal-access-token";
  const workflowWithPat = workflowWith({
    from: "      packages: write",
    to: `      packages: write\n    env:\n      PERSONAL_ACCESS_TOKEN: ${secret}`,
  });

  const result = validateWorkflow(parseWorkflow(workflowWithPat));

  assert.deepEqual(result, { ok: false, errors: ["credential-safety"] });
  assert.equal(JSON.stringify(result).includes(secret), false);
});
