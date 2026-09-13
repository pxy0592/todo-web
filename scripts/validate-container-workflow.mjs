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

  if (!hasRequiredTriggers(workflow)) {
    errors.push("main-triggers");
  }

  if (!hasSafePublishGuard(jobs.publish)) {
    errors.push("publish-guard");
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
