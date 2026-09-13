import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseDocument } from "yaml";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const requiredNodeAlpineImage =
  "node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32";
const requiredDockerIgnoreEntries = [
  ".git/",
  "node_modules/",
  "dist/",
  "test-results/",
  ".superpowers/",
  "docs/openspec/",
  "docs/superpowers/",
  ".env",
  ".env.*",
  "*.log",
];

export function run(command, arguments_, options = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile(command, arguments_, {
      cwd: projectRoot,
      stdio: "inherit",
      ...options,
    });

    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          `${command} ${arguments_.join(" ")} failed${signal ? ` (${signal})` : ""}`,
        ),
      );
    });
  });
}

async function readRequiredFile(root, fileName, errors, errorName) {
  try {
    return await readFile(path.join(root, fileName), "utf8");
  } catch {
    errors.push(errorName);
    return null;
  }
}

function isRequiredDockerfile(source) {
  const stages = [
    ...source.matchAll(
      new RegExp(
        `^FROM\\s+${requiredNodeAlpineImage}\\s+AS\\s+(\\w+)\\s*$`,
        "gim",
      ),
    ),
  ];

  return (
    stages.length === 2 &&
    stages[0][1].toLowerCase() === "builder" &&
    stages[1][1].toLowerCase() === "runtime" &&
    /^RUN\s+npm\s+ci\s*$/m.test(source) &&
    /^RUN\s+npm\s+run\s+build\s*$/m.test(source) &&
    /^COPY\s+--from=builder\s+\/app\/dist\s+\.\/dist\s*$/m.test(source) &&
    /^COPY\s+scripts\/serve\.mjs\s+\.\/serve\.mjs\s*$/m.test(source) &&
    /^USER\s+node\s*$/m.test(source) &&
    /^EXPOSE\s+4173\s*$/m.test(source)
  );
}

function isRequiredCompose(source) {
  const document = parseDocument(source);

  if (document.errors.length > 0) {
    return false;
  }

  const compose = document.toJS();
  const services = compose?.services;
  const service = services?.["todo-web"];

  return (
    services &&
    Object.keys(services).length === 1 &&
    service?.build?.context === "." &&
    service.build.dockerfile === "Dockerfile" &&
    service.image === "todo-web:local" &&
    Array.isArray(service.ports) &&
    service.ports.length === 1 &&
    service.ports[0] === "${TODO_WEB_PORT:-4173}:4173" &&
    service.volumes === undefined &&
    compose.volumes === undefined
  );
}

export async function validateStaticContainerContracts(root = projectRoot) {
  const errors = [];
  const dockerfile = await readRequiredFile(
    root,
    "Dockerfile",
    errors,
    "missing-dockerfile",
  );
  const dockerignore = await readRequiredFile(
    root,
    ".dockerignore",
    errors,
    "missing-dockerignore",
  );
  const compose = await readRequiredFile(
    root,
    "compose.yaml",
    errors,
    "missing-compose",
  );

  if (dockerfile && !isRequiredDockerfile(dockerfile)) {
    errors.push("dockerfile-runtime-contract");
  }

  if (
    dockerignore &&
    !requiredDockerIgnoreEntries.every((entry) =>
      dockerignore.split(/\r?\n/).includes(entry),
    )
  ) {
    errors.push("dockerignore-contract");
  }

  if (compose && !isRequiredCompose(compose)) {
    errors.push("compose-contract");
  }

  return { ok: errors.length === 0, errors };
}

export async function dockerIsAvailable(runCommand = run) {
  try {
    await runCommand("docker", ["info", "--format", "{{.ServerVersion}}"]);
    await runCommand("docker", ["compose", "version"]);
    return true;
  } catch {
    return false;
  }
}

export async function runContainerValidation({
  root = projectRoot,
  runCommand = run,
  isDockerAvailable = () => dockerIsAvailable(runCommand),
} = {}) {
  const staticResult = await validateStaticContainerContracts(root);

  if (!staticResult.ok) {
    throw new Error(
      `Container static validation failed: ${staticResult.errors.join(", ")}`,
    );
  }

  console.log("Container static validation passed");
  await runCommand(process.execPath, [
    "scripts/validate-container-workflow.mjs",
  ]);

  if (!(await isDockerAvailable())) {
    throw new Error(
      "Docker unavailable: runtime container validation requires a reachable Docker Engine and Docker Compose.",
    );
  }

  const smokePort = String(42_000 + (process.pid % 1_000));
  const composeProject = `todo-web-validate-${process.pid}`;
  const composeOverridePort = String(43_000 + (process.pid % 1_000));

  await runCommand("docker", ["build", "-t", "todo-web:local", "."]);
  await runCommand("docker", ["compose", "config"]);
  await runCommand("docker", ["compose", "config"], {
    env: { ...process.env, TODO_WEB_PORT: "4317" },
  });
  await runCommand("sh", ["scripts/container-smoke.sh"], {
    env: { ...process.env, TODO_WEB_SMOKE_PORT: smokePort },
  });
  await runCommand("sh", ["scripts/container-smoke.sh"], {
    env: {
      ...process.env,
      TODO_WEB_SMOKE_MODE: "compose",
      TODO_WEB_COMPOSE_PROJECT: composeProject,
      TODO_WEB_COMPOSE_OVERRIDE_PORT: composeOverridePort,
    },
  });

  console.log("Container runtime validation passed");
}

export async function main(options) {
  try {
    await runContainerValidation(options);
    return true;
  } catch (error) {
    console.error(error.message);
    return false;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = (await main()) ? 0 : 1;
}
