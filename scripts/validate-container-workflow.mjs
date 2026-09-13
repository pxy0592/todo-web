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
const forbiddenCredentialName = /\b(?:PAT|PERSONAL_ACCESS_TOKEN)\b/i;

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

  return (
    typeof condition === "string" &&
    /github\.event_name\s*==\s*['"]push['"]/.test(condition) &&
    /github\.ref\s*==\s*['"]refs\/heads\/main['"]/.test(condition)
  );
}

function hasRootContentsReadPermission(workflow) {
  return (
    workflow?.permissions?.contents === "read" &&
    Object.keys(workflow.permissions).every((permission) =>
      ["contents", "packages"].includes(permission),
    )
  );
}

function hasOnlyRequiredJobs(jobs) {
  return (
    Object.keys(jobs).length === requiredJobs.length &&
    Object.keys(jobs).every((jobName) => requiredJobs.includes(jobName))
  );
}

function hasSafePackagePermissions(workflow) {
  const permissions = workflow?.permissions;
  const jobs = workflow?.jobs ?? {};

  if (permissions?.packages !== undefined) {
    return false;
  }

  return Object.entries(jobs).every(([jobName, job]) => {
    const packagePermission = job?.permissions?.packages;

    if (jobName === "publish") {
      return packagePermission === "write";
    }

    return packagePermission === undefined;
  });
}

function hasForbiddenCredential(value, key = "") {
  if (forbiddenCredentialName.test(key)) {
    return true;
  }

  if (typeof value === "string") {
    return forbiddenCredentialName.test(value);
  }

  if (Array.isArray(value)) {
    return value.some((item) => hasForbiddenCredential(item));
  }

  if (value && typeof value === "object") {
    return Object.entries(value).some(([childKey, childValue]) => {
      if (childKey.toLowerCase().includes("password")) {
        return (
          typeof childValue === "string" &&
          !/^\s*\$\{\{\s*secrets\.GITHUB_TOKEN\s*\}\}\s*$/.test(childValue)
        );
      }

      return hasForbiddenCredential(childValue, childKey);
    });
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

  if (!hasSafePackagePermissions(workflow)) {
    errors.push("package-permissions");
  }

  if (hasForbiddenCredential(workflow)) {
    errors.push("credential-safety");
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

async function main() {
  try {
    const workflow = parseWorkflow(await readFile(workflowPath, "utf8"));
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
