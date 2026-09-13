import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseDocument } from "yaml";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const workflowPath = path.join(
  projectRoot,
  ".github",
  "workflows",
  "container.yml",
);
const requiredJobs = ["build", "test", "image", "publish"];
const requiredNeeds = {
  test: "build",
  image: "test",
  publish: "image",
};
const canonicalPublishGuard =
  "github.event_name=='push'&&github.ref=='refs/heads/main'";
const allowedGitHubToken = /^\s*\$\{\{\s*secrets\.GITHUB_TOKEN\s*\}\}\s*$/;
const credentialKey =
  /(?:^|_)(?:pat|personal_access_token|token|password)(?:_|$)/;
const credentialValue =
  /(?:\b(?:pat|personal[_-]?access[_-]?token)\b|\bgithub_pat_[A-Za-z0-9_]+\b|\bgh[pousr]_[A-Za-z0-9_]+\b)/i;

export function parseWorkflow(source) {
  const document = parseDocument(source);

  if (document.errors.length > 0) {
    throw new Error("Container workflow YAML could not be parsed");
  }

  return document.toJS();
}

function asList(value) {
  if (Array.isArray(value)) {
    return value;
  }

  return value === undefined ? [] : [value];
}

function hasExactKeys(value, expectedKeys) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === expectedKeys.length &&
    expectedKeys.every((key) => Object.hasOwn(value, key))
  );
}

function targetsMain(event) {
  return asList(event?.branches).includes("main");
}

function hasRequiredTriggers(workflow) {
  const triggers = workflow?.on;

  return targetsMain(triggers?.push) && targetsMain(triggers?.pull_request);
}

function hasRequiredNeeds(job, requiredNeed) {
  const needs = asList(job?.needs);

  return needs.length === 1 && needs[0] === requiredNeed;
}

function hasActionStep(steps, action) {
  return steps.some((step) => step?.uses === action);
}

function hasRunStep(steps, command) {
  return steps.some((step) => step?.run === command);
}

function hasNodeSetupStep(steps) {
  return steps.some(
    (step) =>
      step?.uses === "actions/setup-node@v4" &&
      step?.with?.["node-version"] === 22 &&
      step?.with?.cache === "npm",
  );
}

function hasBuildArtifactStep(steps) {
  return steps.some(
    (step) =>
      step?.uses === "actions/upload-artifact@v4" &&
      step?.with?.path === "dist/" &&
      step?.with?.["if-no-files-found"] === "error",
  );
}

function hasRequiredBuildSteps(job) {
  const steps = asList(job?.steps);

  return (
    hasActionStep(steps, "actions/checkout@v4") &&
    hasNodeSetupStep(steps) &&
    hasRunStep(steps, "npm ci") &&
    hasRunStep(steps, "npm run build") &&
    hasBuildArtifactStep(steps)
  );
}

function hasRequiredTestSteps(job) {
  const steps = asList(job?.steps);
  const requiredCommands = [
    "npm ci",
    "npx playwright install --with-deps chromium",
    "npm run format:check",
    "npm run lint",
    "npm run test:unit",
    "npm run test:coverage",
    "npm run test:e2e",
    "npm run build",
  ];

  return (
    hasActionStep(steps, "actions/checkout@v4") &&
    hasNodeSetupStep(steps) &&
    requiredCommands.every((command) => hasRunStep(steps, command))
  );
}

function hasImageArtifactStep(steps) {
  return steps.some(
    (step) =>
      step?.uses === "actions/upload-artifact@v4" &&
      step?.with?.name === "todo-web-image-${{ github.sha }}" &&
      step?.with?.path === "/tmp/todo-web-image.tar" &&
      step?.with?.["if-no-files-found"] === "error",
  );
}

const canonicalShaMetadataRule = {
  format: "long",
  prefix: "sha-",
  type: "sha",
};
const canonicalLatestMetadataRule = {
  enable:
    "${{ github.event_name == 'push' && github.ref == 'refs/heads/main' }}",
  type: "raw",
  value: "latest",
};

function parseMetadataRules(tags) {
  if (typeof tags !== "string") {
    return null;
  }

  const lines = tags
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const rules = [];

  for (const line of lines) {
    const rule = {};

    for (const option of line.split(",")) {
      const separator = option.indexOf("=");
      const key = option.slice(0, separator).trim();
      const value = option.slice(separator + 1).trim();

      if (separator <= 0 || !value || Object.hasOwn(rule, key)) {
        return null;
      }

      rule[key] = value;
    }

    rules.push(rule);
  }

  return rules;
}

function hasExactMetadataRule(rule, expected) {
  return (
    Object.keys(rule).length === Object.keys(expected).length &&
    Object.entries(expected).every(([key, value]) => rule[key] === value)
  );
}

function hasRequiredMetadataRules(tags) {
  const rules = parseMetadataRules(tags);

  if (!rules) {
    return false;
  }

  return (
    rules.length === 2 &&
    rules.some((rule) =>
      hasExactMetadataRule(rule, canonicalShaMetadataRule),
    ) &&
    rules.some((rule) =>
      hasExactMetadataRule(rule, canonicalLatestMetadataRule),
    )
  );
}

function isBuildPushAction(step) {
  return /^docker\/build-push-action@/.test(step?.uses ?? "");
}

function hasBuildxPushFlag(command) {
  const pushFlags = command.matchAll(/(?:^|\s)--push(?:=([^\s]+))?(?=\s|$)/gi);

  return [...pushFlags].some(
    (match) => !match[1] || match[1].toLowerCase() !== "false",
  );
}

function hasBuildxRegistryOutput(command) {
  return /(?:^|\s)(?:--output(?:=|\s+)|-o(?:=|\s*)?)(?:type\s*=\s*)?registry(?=,|\s|$)/i.test(
    command,
  );
}

function isImagePublishCommand(command) {
  if (typeof command !== "string") {
    return false;
  }

  const invokesBuildx = /\bdocker\s+buildx\s+build\b/i.test(command);

  return (
    /\bdocker\s+(?:login|push)\b/i.test(command) ||
    (invokesBuildx &&
      (hasBuildxPushFlag(command) || hasBuildxRegistryOutput(command)))
  );
}

function hasRequiredImageSteps(job) {
  const steps = asList(job?.steps);
  const metadataStep = steps.find(
    (step) => step?.uses === "docker/metadata-action@v5",
  );
  const buildSteps = steps.filter(isBuildPushAction);
  const [buildStep] = buildSteps;

  return (
    hasActionStep(steps, "actions/checkout@v4") &&
    hasActionStep(steps, "docker/setup-buildx-action@v3") &&
    metadataStep?.id === "meta" &&
    metadataStep?.with?.images === "ghcr.io/${{ github.repository }}" &&
    hasRequiredMetadataRules(metadataStep?.with?.tags) &&
    buildSteps.length === 1 &&
    buildStep?.uses === "docker/build-push-action@v6" &&
    buildStep?.with?.context === "." &&
    buildStep?.with?.file === "./Dockerfile" &&
    buildStep?.with?.tags === "${{ steps.meta.outputs.tags }}" &&
    buildStep?.with?.labels === "${{ steps.meta.outputs.labels }}" &&
    buildStep?.with?.outputs === "type=docker,dest=/tmp/todo-web-image.tar" &&
    buildStep?.with?.push === false &&
    hasImageArtifactStep(steps) &&
    !steps.some(
      (step) =>
        step?.uses?.startsWith("docker/login-action@") ||
        isImagePublishCommand(step?.run),
    )
  );
}

function hasRequiredPublishSteps(job) {
  const steps = asList(job?.steps);
  const expectedSteps = [
    (step) =>
      step?.uses === "actions/download-artifact@v4" &&
      hasExactKeys(step.with, ["name", "path"]) &&
      step.with.name === "todo-web-image-${{ github.sha }}" &&
      step.with.path === "/tmp/todo-web-image",
    (step) =>
      hasExactKeys(step, ["run"]) &&
      step.run === "docker load --input /tmp/todo-web-image/todo-web-image.tar",
    (step) =>
      step?.uses === "docker/login-action@v3" &&
      hasExactKeys(step.with, ["registry", "username", "password"]) &&
      step.with.registry === "ghcr.io" &&
      step.with.username === "${{ github.actor }}" &&
      allowedGitHubToken.test(step.with.password),
    (step) =>
      hasExactKeys(step, ["run"]) &&
      step.run ===
        "docker push ghcr.io/${{ github.repository }}:sha-${{ github.sha }}",
    (step) =>
      hasExactKeys(step, ["run", "if"]) &&
      step.run === "docker push ghcr.io/${{ github.repository }}:latest" &&
      step.if === "github.ref == 'refs/heads/main'",
  ];

  return (
    job?.["runs-on"] === "ubuntu-latest" &&
    steps.length === expectedSteps.length &&
    expectedSteps.every((expectedStep, index) => expectedStep(steps[index]))
  );
}

function hasSafePublishGuard(job) {
  const condition = job?.if;

  if (typeof condition !== "string") {
    return false;
  }

  let depth = 0;

  for (const character of condition) {
    if (character === "(") {
      depth += 1;
    } else if (character === ")") {
      depth -= 1;
      if (depth < 0) {
        return false;
      }
    }
  }

  return (
    depth === 0 &&
    condition.replace(/[\s()]/g, "") === canonicalPublishGuard &&
    !condition.includes("||") &&
    !condition.includes("!")
  );
}

function hasRootContentsReadPermission(workflow) {
  const permissions = workflow?.permissions;

  return (
    hasExactKeys(permissions, ["contents"]) && permissions.contents === "read"
  );
}

function hasOnlyRequiredJobs(jobs) {
  return (
    jobs &&
    typeof jobs === "object" &&
    Object.keys(jobs).length === requiredJobs.length &&
    requiredJobs.every((jobName) => Object.hasOwn(jobs, jobName))
  );
}

function hasSafeJobPermissions(jobName, job) {
  const permissions = job?.permissions;

  if (permissions === undefined) {
    return jobName !== "publish";
  }

  if (jobName === "publish") {
    return (
      hasExactKeys(permissions, ["contents", "packages"]) &&
      permissions.contents === "read" &&
      permissions.packages === "write"
    );
  }

  return (
    hasExactKeys(permissions, ["contents"]) && permissions.contents === "read"
  );
}

function hasSafePermissions(workflow) {
  const jobs = workflow?.jobs;

  return (
    hasRootContentsReadPermission(workflow) &&
    jobs &&
    typeof jobs === "object" &&
    Object.entries(jobs).every(([jobName, job]) =>
      hasSafeJobPermissions(jobName, job),
    )
  );
}

function normalizeCredentialKey(key) {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function hasForbiddenCredential(value, key = "") {
  if (typeof value === "string" && credentialValue.test(value)) {
    return true;
  }

  if (credentialKey.test(normalizeCredentialKey(key))) {
    return typeof value !== "string" || !allowedGitHubToken.test(value);
  }

  if (typeof value === "string") {
    return allowedGitHubToken.test(value);
  }

  if (Array.isArray(value)) {
    return value.some((item) => hasForbiddenCredential(item));
  }

  if (value && typeof value === "object") {
    return Object.entries(value).some(([childKey, childValue]) =>
      hasForbiddenCredential(childValue, childKey),
    );
  }

  return false;
}

export function validateWorkflow(workflow) {
  const errors = [];
  const jobs = workflow?.jobs ?? {};

  if (
    !requiredJobs.every((jobName) => jobs[jobName]) ||
    !hasOnlyRequiredJobs(jobs)
  ) {
    errors.push("required-jobs");
  }

  if (
    !Object.entries(requiredNeeds).every(([jobName, requiredNeed]) =>
      hasRequiredNeeds(jobs[jobName], requiredNeed),
    )
  ) {
    errors.push("job-needs");
  }

  if (!hasRequiredBuildSteps(jobs.build)) {
    errors.push("build-job-steps");
  }

  if (!hasRequiredTestSteps(jobs.test)) {
    errors.push("test-job-steps");
  }

  if (!hasRequiredImageSteps(jobs.image)) {
    errors.push("image-job-steps");
  }

  if (!hasRequiredTriggers(workflow)) {
    errors.push("main-triggers");
  }

  if (!hasSafePublishGuard(jobs.publish)) {
    errors.push("publish-guard");
  }

  if (!hasRequiredPublishSteps(jobs.publish)) {
    errors.push("publish-job-steps");
  }

  if (!hasRootContentsReadPermission(workflow)) {
    errors.push("contents-permission");
  }

  if (!hasSafePermissions(workflow)) {
    errors.push("package-permissions");
  }

  if (hasForbiddenCredential(workflow)) {
    errors.push("credential-safety");
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

async function main() {
  try {
    const sourcePath = process.argv[2] ?? workflowPath;
    const workflow = parseWorkflow(await readFile(sourcePath, "utf8"));
    const result = validateWorkflow(workflow);

    if (!result.ok) {
      console.error(
        `Container workflow validation failed: ${result.errors.join(", ")}`,
      );
      process.exitCode = 1;
      return;
    }

    console.log("Container workflow validation passed");
  } catch {
    console.error("Container workflow validation failed");
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
