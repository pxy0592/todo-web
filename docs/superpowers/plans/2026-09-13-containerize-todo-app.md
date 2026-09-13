---
change: containerize-todo-app
design-doc: docs/superpowers/specs/2026-09-13-containerize-todo-app-design.md
base-ref: b7005a6ac0f04b6f945f0210f69773527971b08b
---

# Containerize Todo App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Add a minimal Node-based container runtime, Docker Compose entry point, and gated GitHub Actions pipeline that builds, tests, tags, and publishes the Todo Web image to GHCR.

**Architecture:** Keep the existing browser application and Python-based host-development command unchanged. Add a Node-native `scripts/serve.mjs` for the container runtime, use a two-stage pinned Node Alpine Dockerfile that copies only `dist/` and the server entry point into runtime, and define one Compose service on container port 4173. Use four dependent GitHub jobs—`build -> test -> image -> publish`—with an image artifact crossing runner boundaries; only the permitted `main` push path publishes to GHCR.

**Tech Stack:** Docker Engine/BuildKit, Docker Compose v2, Node.js 22 Alpine, native Node `http`/filesystem APIs, existing npm build/test/lint/coverage/E2E commands, GitHub Actions, `docker/setup-buildx-action`, `docker/metadata-action`, `docker/login-action`, `docker/build-push-action`, GHCR, and a small Node/YAML validation utility.

**Spec:** `docs/openspec/changes/containerize-todo-app/specs/containerized-delivery/spec.md`; design: `docs/superpowers/specs/2026-09-13-containerize-todo-app-design.md`; task source of truth: `docs/openspec/changes/containerize-todo-app/tasks.md`.

## Global Constraints

- OpenSpec is the behavioral source of truth; do not modify `proposal.md` or `specs/containerized-delivery/spec.md` unless an actual requirement changes.
- `docs/openspec/changes/containerize-todo-app/tasks.md` is the unique task source of truth; every plan task below links to its exact OpenSpec task number.
- Preserve the existing Todo application behavior, browser `localStorage` format, `npm run start` Python development path, and existing Node/Playwright test suite.
- Container-side data persistence is out of scope: do not add a backend, database, Docker volume, container filesystem data store, or persistence acceptance scenario.
- Use a pinned official Node.js Alpine LTS tag consistently in builder and runtime stages; the design example is `node:22-alpine`.
- Runtime image contents are limited to `/app/dist/**` and `/app/serve.mjs` plus files intrinsically required by the selected Node base image; do not copy source, tests, docs, OpenSpec, agent artifacts, `.env`, caches, or development dependencies.
- The container server listens on `0.0.0.0`, reads `PORT`, defaults to `4173`, serves only `dist/`, returns 404 for missing/traversal paths, and does not list directories.
- Compose defines exactly one `todo-web` service, uses `build: .`, image `todo-web:local`, and `${TODO_WEB_PORT:-4173}:4173`; it has no volumes or external services.
- Workflow events are PRs targeting `main` and pushes to `main`; PRs build/test/image but do not publish, while allowed `main` pushes run publish.
- Workflow job dependencies are exactly `test.needs: build`, `image.needs: test`, and `publish.needs: image`; downstream jobs must not run after prerequisite failure.
- GHCR publishing uses `ghcr.io/${{ github.repository }}`, `${{ secrets.GITHUB_TOKEN }}`, and only `contents: read` plus `packages: write` on the publish job; no PAT or long-lived credential may be committed.
- Every OpenSpec scenario requires automated or static validation evidence; all existing application gates and all container/workflow gates must pass before marking the final OpenSpec tasks complete.

## File Map

- Create `.dockerignore`: build-context exclusions for repository metadata, dependencies, generated files, secrets, OpenSpec, and agent artifacts.
- Create `scripts/serve.mjs`: dependency-free Node static server used only by the runtime image.
- Create `tests/serve.test.js`: focused HTTP server tests for content serving, 404, MIME types, traversal rejection, directory handling, and shutdown.
- Create `Dockerfile`: pinned multi-stage builder/runtime image definition.
- Create `compose.yaml`: single-service local Compose runtime and port interpolation.
- Create `.github/workflows/container.yml`: four dependent CI jobs, image artifact transfer, GHCR metadata, and publish guard.
- Create `scripts/validate-container-workflow.mjs`: deterministic YAML/job graph/permission/tag/security assertions.
- Create `tests/container-workflow.test.js`: tests the workflow validator and its required invariants without contacting GHCR.
- Modify `package.json`: add workflow validation command and any YAML parser dependency; do not remove existing application commands.
- Modify `package-lock.json`: lock new development dependency if one is required.
- Modify `README.md`: document Docker/Compose usage, host-vs-container server paths, GHCR tags, workflow triggers, and permissions.

## Implementation Tasks

### Task 1: Define the Docker build context boundary

**OpenSpec link:** `docs/openspec/changes/containerize-todo-app/tasks.md` 1.1

**Files:**
- Create: `.dockerignore`
- Test/verification: Docker build context inspection in Task 4.1/4.3 validation scripts

**Interfaces:**
- Docker receives the repository root as context.
- Dockerfile `COPY` can only see non-ignored build inputs.
- Later tasks rely on `.dockerignore` excluding `.git/`, `node_modules/`, `dist/`, `test-results/`, `.superpowers/`, `docs/openspec/`, `docs/superpowers/`, `.env`, `.env.*`, and `*.log`.

- [ ] **Step 1: Add the exact ignore rules.**

  Create `.dockerignore` with:

  ```text
  .git/
  node_modules/
  dist/
  test-results/
  .superpowers/
  docs/openspec/
  docs/superpowers/
  .env
  .env.*
  *.log
  ```

  Keep the file focused on build-context protection; do not ignore `index.html`, `src/`, `styles/`, `package*.json`, or required build/runtime scripts.

- [ ] **Step 2: Verify the context boundary without leaking local data.**

  Use Docker’s plain-progress build output or a temporary build probe only if necessary. Confirm the ignore file itself is present, `docker build` does not fail because required inputs are excluded, and later image inspection cannot find ignored paths. Do not print environment-file contents or credentials.

- [ ] **Step 3: Commit the independently reviewable boundary.**

  ```bash
  git add .dockerignore
  git commit -m "chore(container): restrict Docker build context (task 1.1)"
  ```

### Task 2: Implement and test the Node container static server

**OpenSpec link:** `docs/openspec/changes/containerize-todo-app/tasks.md` 1.3

**Files:**
- Create: `scripts/serve.mjs`
- Create: `tests/serve.test.js`
- Modify: `package.json` only if a focused server test script is needed

**Interfaces:**
- `startServer({ rootDirectory, port, host }) -> Promise<{ server, address }>` or an equivalent exported testable API.
- Production entry point reads `process.env.PORT || '4173'`, serves the path resolved from the runtime script’s adjacent `dist/`, and listens on `0.0.0.0`.
- HTTP responses provide status, safe file body, and basic MIME type mapping; no directory listing is exposed.
- Shutdown closes the HTTP server cleanly on SIGTERM/SIGINT.

- [ ] **Step 1: Write focused failing tests first.**

  Create tests using a temporary fixture directory and an ephemeral port. Cover:

  ```js
  test('serves index.html for the root request', async () => {
    const response = await request('/');
    assert.equal(response.statusCode, 200);
    assert.match(response.headers['content-type'], /text\/html/);
  });

  test('rejects missing and traversal-shaped paths', async () => {
    assert.equal((await request('/missing')).statusCode, 404);
    assert.equal((await request('/../package.json')).statusCode, 404);
  });
  ```

  Also test CSS/JS MIME types, a directory request without listing, URL decoding, and server close. Run `node --test tests/serve.test.js` before creating the implementation and record the expected missing-module or missing-export failure.

- [ ] **Step 2: Implement the minimal safe server.**

  Use `node:http`, `node:fs/promises`, `node:path`, and `node:url`. Convert the URL pathname to a decoded relative path, reject null bytes and traversal segments, resolve it beneath the fixed static root, require a regular file, map `/` to `index.html`, and return 404/400 without exposing filesystem paths. Use `Content-Type` mappings for `.html`, `.css`, `.js`, `.json`, common images, and an octet-stream fallback. Do not use `innerHTML`, directory indexes, API routes, compression, TLS, or external packages.

- [ ] **Step 3: Verify GREEN and refactor while green.**

  Run:

  ```bash
  node --test tests/serve.test.js
  npm run format:check
  npm run lint
  ```

  Refactor only for small helpers such as `resolveStaticPath` and `contentTypeFor`, keeping tests green. Ensure the executable path used by Docker is exactly `node /app/serve.mjs` and the server’s default port is 4173.

- [ ] **Step 4: Commit the server.**

  ```bash
  git add scripts/serve.mjs tests/serve.test.js
  git commit -m "feat(container): add safe Node static server (task 1.3)"
  ```

### Task 3: Add the multi-stage Dockerfile

**OpenSpec link:** `docs/openspec/changes/containerize-todo-app/tasks.md` 1.2

**Files:**
- Create: `Dockerfile`
- Modify: none

**Interfaces:**
- Input: existing `package.json`, `package-lock.json`, `index.html`, `src/`, `styles/`, `scripts/build.mjs`, and the new `scripts/serve.mjs`.
- Output: image tag `todo-web:local` with `/app/dist/**` and `/app/serve.mjs` runtime content.
- Runtime process: `node /app/serve.mjs` on container port 4173 as a non-root user.

- [ ] **Step 1: Define the builder stage.**

  Use a pinned base and cache-friendly dependency order:

  ```dockerfile
  FROM node:22-alpine AS builder
  WORKDIR /app
  COPY package.json package-lock.json ./
  RUN npm ci
  COPY index.html ./
  COPY src ./src
  COPY styles ./styles
  COPY scripts/build.mjs ./scripts/build.mjs
  RUN npm run build
  ```

  Do not copy tests, docs, `.git`, `.env`, or the runtime server into the builder unless the build command requires it; `scripts/serve.mjs` is runtime-only.

- [ ] **Step 2: Define the minimal runtime stage.**

  Use the same pinned Node Alpine family:

  ```dockerfile
  FROM node:22-alpine AS runtime
  WORKDIR /app
  ENV NODE_ENV=production
  COPY --from=builder /app/dist ./dist
  COPY scripts/serve.mjs ./serve.mjs
  USER node
  EXPOSE 4173
  CMD ["node", "/app/serve.mjs"]
  ```

  Keep runtime `node_modules/` absent by not copying it; the official base user and Node runtime remain available. If the implementation requires a base-image directory for runtime behavior, document and test that exception rather than copying development dependencies.

- [ ] **Step 3: Build and inspect the image.**

  Run:

  ```bash
  docker build --progress=plain -t todo-web:local .
  docker image inspect todo-web:local --format '{{.Config.User}} {{json .Config.ExposedPorts}}'
  docker run --rm todo-web:local find /app -maxdepth 2 -type f | sort
  ```

  Expected: build succeeds, configured user is non-root, port 4173 is exposed, and runtime file listing contains `serve.mjs` plus built static files but no tests, docs, OpenSpec, `.env`, source tree, or dependency cache.

- [ ] **Step 4: Commit the image definition.**

  ```bash
  git add Dockerfile
  git commit -m "feat(container): add minimal multi-stage image (task 1.2)"
  ```

### Task 4: Verify standalone container HTTP behavior

**OpenSpec link:** `docs/openspec/changes/containerize-todo-app/tasks.md` 1.3 and 4.1

**Files:**
- Modify: `tests/serve.test.js` only if the standalone smoke helper needs reuse
- Create: `scripts/container-smoke.sh` or an equivalent Node shell-free validation script if repeated commands need packaging

**Interfaces:**
- Consumes image `todo-web:local` from Task 3.
- Verifies host-to-container port `4173:4173`, HTTP resources, 404/traversal behavior, and cleanup.
- Produces a non-zero exit code on any failed HTTP/content/image-boundary assertion.

- [ ] **Step 1: Start a named smoke container.**

  ```bash
  docker rm -f todo-web-smoke 2>/dev/null || true
  docker run --rm -d --name todo-web-smoke -p 4173:4173 todo-web:local
  trap 'docker rm -f todo-web-smoke >/dev/null 2>&1 || true' EXIT
  ```

- [ ] **Step 2: Assert HTTP behavior and content types.**

  ```bash
  curl --fail http://127.0.0.1:4173/
  curl --fail -I http://127.0.0.1:4173/styles/app.css
  curl --fail http://127.0.0.1:4173/src/main.js
  test "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:4173/missing)" = 404
  test "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:4173/../package.json)" = 404
  ```

  Check the HTML body includes `src/main.js`, CSS is `text/css`, and JavaScript is a JavaScript MIME type. Do not treat a successful Docker process alone as HTTP readiness.

- [ ] **Step 3: Assert runtime boundary and cleanup.**

  Inspect the image without secrets, verify no runtime volume/mount is required, and run `docker rm -f todo-web-smoke`. Confirm the container is gone with `docker ps -q -f name=todo-web-smoke` returning empty.

- [ ] **Step 4: Commit any reusable smoke helper.**

  ```bash
  git add scripts/container-smoke.sh tests/serve.test.js
  git commit -m "test(container): add image HTTP smoke checks (tasks 1.3, 4.1)"
  ```

### Task 5: Define and validate the Compose service

**OpenSpec link:** `docs/openspec/changes/containerize-todo-app/tasks.md` 2.1

**Files:**
- Create: `compose.yaml`
- Create: `tests/compose-config.test.js` or include checks in the container validation script

**Interfaces:**
- Compose project exposes one service named `todo-web`.
- Service build definition uses context `.`, Dockerfile `Dockerfile`, image `todo-web:local`.
- Later tasks rely on valid output from `docker compose config`.

- [ ] **Step 1: Add Compose YAML with exactly one service.**

  ```yaml
  services:
    todo-web:
      build:
        context: .
        dockerfile: Dockerfile
      image: todo-web:local
      ports:
        - "${TODO_WEB_PORT:-4173}:4173"
  ```

  Do not add volumes, privileged mode, host networking, databases, source mounts, or extra services.

- [ ] **Step 2: Validate default and overridden configuration.**

  Run:

  ```bash
  docker compose config
  TODO_WEB_PORT=4317 docker compose config
  ```

  Assert the rendered service count is one, build Dockerfile is `Dockerfile`, image is `todo-web:local`, default mapping is `4173:4173`, and override mapping is `4317:4173`. Use a YAML-aware assertion rather than fragile text matching when adding the test utility.

- [ ] **Step 3: Commit the Compose contract.**

  ```bash
  git add compose.yaml tests/compose-config.test.js
  git commit -m "feat(container): add Compose runtime contract (tasks 2.1, 2.2)"
  ```

### Task 6: Run the Compose lifecycle and HTTP smoke

**OpenSpec link:** `docs/openspec/changes/containerize-todo-app/tasks.md` 2.2 and 2.3

**Files:**
- Modify: `scripts/container-smoke.sh` or validation utility if lifecycle logic is centralized
- Create: `tests/compose-runtime.test.js` only if a repeatable automated wrapper is needed

**Interfaces:**
- Consumes `compose.yaml` and `todo-web:local`.
- Verifies no host Node/Python is needed after Docker/Compose is installed.
- Does not create or remove resources outside this Compose project.

- [ ] **Step 1: Start the default Compose service and wait for HTTP.**

  ```bash
  docker compose up --build -d
  for attempt in $(seq 1 30); do
    curl --fail http://127.0.0.1:4173/ >/dev/null && break
    sleep 1
  done
  curl --fail http://127.0.0.1:4173/
  docker compose ps
  ```

  Fail explicitly if the readiness loop expires. Confirm the Compose service is the only project service and the page contains the application entry point.

- [ ] **Step 2: Verify port override.**

  Stop the default project, start with `TODO_WEB_PORT=4317 docker compose up --build -d`, and request `http://127.0.0.1:4317/`. Confirm `docker compose config` and the actual published port agree.

- [ ] **Step 3: Verify cleanup/resource scope.**

  Run:

  ```bash
  docker compose down
  docker compose ps -q
  ```

  Expected: this project has no remaining application container, no volume is declared or removed, and no unrelated container is targeted. Record Docker command output without exposing environment values.

- [ ] **Step 4: Commit only reusable lifecycle changes.**

  ```bash
  git add scripts/container-smoke.sh tests/compose-runtime.test.js
  git commit -m "test(container): verify Compose lifecycle (tasks 2.2, 2.3)"
  ```

### Task 7: Add workflow YAML and dependency-graph validation

**OpenSpec link:** `docs/openspec/changes/containerize-todo-app/tasks.md` 3.1 and 4.1

**Files:**
- Create: `.github/workflows/container.yml`
- Create: `scripts/validate-container-workflow.mjs`
- Create: `tests/container-workflow.test.js`
- Modify: `package.json` and `package-lock.json` if adding the `yaml` dev dependency

**Interfaces:**
- Validator reads `.github/workflows/container.yml` and returns success only when required jobs and invariants are present.
- Workflow jobs are named `build`, `test`, `image`, and `publish`.
- Validator exposes a command such as `node scripts/validate-container-workflow.mjs` and can be run without GitHub credentials or Docker.

- [ ] **Step 1: Add parser/validator tests before workflow implementation.**

  Use a YAML parser and fixture strings to test required graph rules:

  ```js
  test('requires the build to test to image to publish chain', () => {
    assert.deepEqual(validateWorkflow(validWorkflow), { ok: true });
    assert.equal(validateWorkflow(workflowWithoutPublishNeed).ok, false);
  });
  ```

  Add cases for missing jobs, wrong `needs`, missing events, unsafe publish condition, missing `packages: write`, missing SHA tag, hard-coded PAT text, and absent image-artifact transfer. Run `node --test tests/container-workflow.test.js` before the validator/workflow exists and record the expected RED failure.

- [ ] **Step 2: Implement the four-job workflow skeleton.**

  Start with:

  ```yaml
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
  ```

  Replace placeholders with valid job steps in later tasks while preserving exact job names and dependencies.

- [ ] **Step 3: Implement static validation invariants.**

  Parse YAML with a trusted parser, normalize `needs` from string/array forms, and assert:

  ```text
  build, test, image, publish exist
  test.needs contains build
  image.needs contains test
  publish.needs contains image
  push.main and pull_request.main triggers exist
  publish has an explicit push/main guard
  workflow/job permissions never grant broader package permissions than required
  ```

  Reject tokens matching long-lived credentials such as `PAT`, `PERSONAL_ACCESS_TOKEN`, or literal registry passwords. Never print parsed secrets.

- [ ] **Step 4: Add a package command and commit the graph validator.**

  Add a script such as:

  ```json
  "validate:container-workflow": "node scripts/validate-container-workflow.mjs"
  ```

  Run focused validator tests and the command, then commit:

  ```bash
  git add .github/workflows/container.yml scripts/validate-container-workflow.mjs tests/container-workflow.test.js package.json package-lock.json
  git commit -m "ci(container): define workflow dependency validation (task 3.1)"
  ```

### Task 8: Implement the workflow build and test jobs

**OpenSpec link:** `docs/openspec/changes/containerize-todo-app/tasks.md` 3.2

**Files:**
- Modify: `.github/workflows/container.yml`
- Modify: `scripts/validate-container-workflow.mjs` and `tests/container-workflow.test.js` for exact command/event assertions

**Interfaces:**
- `build` checks out the triggering commit, installs Node 22, runs `npm ci` and `npm run build`, and uploads `dist/` as an artifact.
- `test` declares `needs: build`, checks out the same commit, runs `npm ci`, installs Chromium, runs format/lint/unit/coverage/E2E/build checks, and can verify the build artifact exists.
- A failed `build` or `test` prevents downstream jobs through `needs`.

- [ ] **Step 1: Add validator tests for build/test job commands.**

  Assert the workflow includes `actions/checkout`, `actions/setup-node` with Node 22, `npm ci`, `npm run build`, artifact upload in `build`, and in `test` the existing application gates plus Playwright browser installation. Assert the test job’s `needs` is exactly or includes `build`.

- [ ] **Step 2: Implement `build` with artifact output.**

  Use pinned major versions consistently with the repository’s selected action policy:

  ```yaml
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
          name: todo-web-dist-${{ github.sha }}
          path: dist/
          if-no-files-found: error
  ```

- [ ] **Step 3: Implement `test` after `build`.**

  Run the existing gates without weakening them:

  ```yaml
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
  ```

  If downloading the build artifact for an explicit existence assertion, add `actions/download-artifact@v4` and verify `dist/index.html`; do not replace source tests with artifact-only checks.

- [ ] **Step 4: Validate the graph and commit.**

  Run `npm run validate:container-workflow`, focused tests, and existing application checks. Commit:

  ```bash
  git add .github/workflows/container.yml scripts/validate-container-workflow.mjs tests/container-workflow.test.js
  git commit -m "ci(container): add build and test jobs (task 3.2)"
  ```

### Task 9: Implement image build, metadata, and cross-runner artifact export

**OpenSpec link:** `docs/openspec/changes/containerize-todo-app/tasks.md` 3.3 and 3.5

**Files:**
- Modify: `.github/workflows/container.yml`
- Modify: workflow validator tests/scripts

**Interfaces:**
- `image` declares `needs: test`, builds from the repository Dockerfile, and does not push.
- Metadata output provides `ghcr.io/${{ github.repository }}` plus immutable SHA tag `sha-${{ github.sha }}` and default-branch convenience tag.
- The image is exported as an artifact that `publish` can load on a different GitHub runner.

- [ ] **Step 1: Add failing metadata/artifact assertions.**

  Extend validator tests to reject workflows that lack Docker Buildx setup, Docker metadata, Dockerfile reference, SHA tag, image export/upload, or an image job that pushes directly. Assert PR builds can validate the image without registry credentials.

- [ ] **Step 2: Implement the image job.**

  Use Docker actions and explicit outputs:

  ```yaml
  image:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - uses: docker/metadata-action@v5
        id: meta
        with:
          images: ghcr.io/${{ github.repository }}
          tags: |
            type=sha,format=long,prefix=sha-
            type=raw,value=latest,enable=${{ github.event_name == 'push' && github.ref == 'refs/heads/main' }}
      - uses: docker/build-push-action@v6
        with:
          context: .
          file: ./Dockerfile
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          outputs: type=docker,dest=/tmp/todo-web-image.tar
          push: false
      - uses: actions/upload-artifact@v4
        with:
          name: todo-web-image-${{ github.sha }}
          path: /tmp/todo-web-image.tar
          if-no-files-found: error
  ```

  Keep the image job free of login and push operations.

- [ ] **Step 3: Validate tag semantics.**

  Confirm the SHA tag is always produced, `latest` is enabled only for `push` to `refs/heads/main`, and no PR metadata is published. Run `npm run validate:container-workflow` and its focused tests.

- [ ] **Step 4: Commit image job changes.**

  ```bash
  git add .github/workflows/container.yml scripts/validate-container-workflow.mjs tests/container-workflow.test.js
  git commit -m "ci(container): build traceable image artifact (tasks 3.3, 3.5)"
  ```

### Task 10: Implement secure GHCR publish job

**OpenSpec link:** `docs/openspec/changes/containerize-todo-app/tasks.md` 3.4

**Files:**
- Modify: `.github/workflows/container.yml`
- Modify: workflow validator scripts/tests

**Interfaces:**
- `publish` consumes the image artifact from `image`, loads it with Docker, logs into GHCR only for allowed `main` pushes, and pushes the exact built tags.
- Job permissions are `contents: read` and `packages: write`; workflow-wide permissions stay read-only.
- No credential values are hard-coded.

- [ ] **Step 1: Add failing security/publish assertions.**

  Test validator failures for missing job-level `packages: write`, direct publish on pull requests, missing `GITHUB_TOKEN`, wrong GHCR image, missing artifact download/load, and literal PAT/password patterns.

- [ ] **Step 2: Implement the guarded publish job.**

  Use an explicit condition and minimal permissions:

  ```yaml
  publish:
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    needs: image
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    steps:
      - uses: actions/download-artifact@v4
        with:
          name: todo-web-image-${{ github.sha }}
          path: /tmp/todo-web-image
      - run: docker load --input /tmp/todo-web-image/todo-web-image.tar
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - run: docker push ghcr.io/${{ github.repository }}:sha-${{ github.sha }}
      - run: docker push ghcr.io/${{ github.repository }}:latest
        if: github.ref == 'refs/heads/main'
  ```

  Ensure the actual tag format emitted by metadata-action matches the push references; if metadata emits a full SHA instead of the exact expression, push the metadata output tags rather than inventing a mismatched tag.

- [ ] **Step 3: Validate no PR publication.**

  Run static workflow validation and inspect the parsed `if` expression, permissions, token source, and artifact path. Do not attempt a real GHCR upload from a local environment or print secrets.

- [ ] **Step 4: Commit the publish job.**

  ```bash
  git add .github/workflows/container.yml scripts/validate-container-workflow.mjs tests/container-workflow.test.js
  git commit -m "ci(container): publish main images to GHCR (task 3.4)"
  ```

### Task 11: Add reusable container/workflow validation entry points

**OpenSpec link:** `docs/openspec/changes/containerize-todo-app/tasks.md` 4.1

**Files:**
- Create or modify: `scripts/validate-container-workflow.mjs`
- Create: `scripts/validate-container.mjs` or `scripts/container-smoke.sh`
- Create: `tests/container-workflow.test.js` and/or `tests/container-validation.test.js`
- Modify: `package.json`

**Interfaces:**
- `npm run validate:container-workflow` validates workflow YAML, dependency graph, triggers, permissions, tags, artifact transfer, and credential safety without external credentials.
- `npm run validate:container` validates Dockerfile/Compose static contracts and, when Docker is available, runs image/HTTP/Compose smoke checks with clear non-zero failures.
- Validation commands never print secret values and fail clearly on missing inputs or invalid configuration.

- [ ] **Step 1: Add static Docker/Compose contract assertions.**

  Assert required files exist and contain exact contracts: Dockerfile has two Node Alpine stages, `npm ci`, `npm run build`, runtime `serve.mjs`, `USER node`, and `EXPOSE 4173`; `.dockerignore` includes required exclusions; Compose has one service, expected image/build/port, and no volumes.

- [ ] **Step 2: Add image/runtime inspection assertions.**

  Implement shell-free Node child-process wrappers or a carefully trapped shell helper that:

  - runs `docker build -t todo-web:local .`;
  - starts the named container and polls HTTP readiness;
  - checks `/`, CSS, JS, missing path, and traversal-shaped path;
  - inspects runtime files and configured user/port;
  - always removes the smoke container in cleanup;
  - runs `docker compose config` for default and overridden ports;
  - runs Compose up/status/down only when Docker/Compose are available.

  Report “Docker unavailable” as a failed validation for Task 4.1/4.3 rather than silently claiming runtime success.

- [ ] **Step 3: Add workflow fixture failure tests.**

  Feed the validator minimal invalid YAML fixtures and assert actionable failures for missing job dependencies, unsafe permissions, PR publish, missing SHA/latest tags, direct publish from image, missing image artifact, and hard-coded credentials.

- [ ] **Step 4: Commit reusable validation.**

  ```bash
  git add scripts/validate-container.mjs scripts/validate-container-workflow.mjs tests/container-validation.test.js tests/container-workflow.test.js package.json package-lock.json
  git commit -m "test(container): validate delivery contracts (task 4.1)"
  ```

### Task 12: Update README for container and workflow usage

**OpenSpec link:** `docs/openspec/changes/containerize-todo-app/tasks.md` 4.2

**Files:**
- Modify: `README.md`

**Interfaces:**
- Documentation commands must exactly match `Dockerfile`, `compose.yaml`, package scripts, and `.github/workflows/container.yml`.
- Documentation distinguishes host development (`npm run start`, Python) from container runtime (Node server inside image).

- [ ] **Step 1: Document prerequisites and local image flow.**

  Add Docker Engine/Compose prerequisites and commands:

  ```bash
  docker build -t todo-web:local .
  docker run --rm -d --name todo-web-smoke -p 4173:4173 todo-web:local
  curl --fail http://127.0.0.1:4173/
  docker rm -f todo-web-smoke
  ```

  State that the container does not require host Python or Node.js; the existing `npm run start` remains the Python development path.

- [ ] **Step 2: Document Compose operations and port override.**

  ```bash
  docker compose up --build -d
  curl --fail http://127.0.0.1:4173/
  TODO_WEB_PORT=4317 docker compose up --build -d
  curl --fail http://127.0.0.1:4317/
  docker compose ps
  docker compose down
  ```

  Explicitly state that no Docker volume or container-side Todo persistence is provided by this change; existing browser `localStorage` behavior is not changed.

- [ ] **Step 3: Document GHCR and workflow behavior.**

  Explain:

  - image name `ghcr.io/<owner>/<repo>`;
  - immutable `sha-<commit>` tag;
  - `latest` only for successful `main` pushes;
  - PRs run build/test/image but do not upload;
  - `main` pushes run publish;
  - publish uses `GITHUB_TOKEN` and requires package write permission;
  - `npm run validate:container-workflow` and container validation commands.

- [ ] **Step 4: Verify documentation and commit.**

  Run the documented commands where Docker is available, `npm run format:check`, `npm run lint`, and workflow validation. Commit:

  ```bash
  git add README.md
  git commit -m "docs(container): document Compose and GHCR delivery (task 4.2)"
  ```

### Task 13: Run complete application and delivery validation

**OpenSpec link:** `docs/openspec/changes/containerize-todo-app/tasks.md` 4.3

**Files:**
- Modify: validation scripts/tests only if a concrete failing validation is found
- Modify: `docs/openspec/changes/containerize-todo-app/tasks.md` after all evidence is collected

**Interfaces:**
- All commands below must exit successfully before marking 4.3 complete.
- Validation output must include command, exit status, test count, image/Compose result, workflow validator result, and any environment limitation.

- [ ] **Step 1: Run existing application gates.**

  ```bash
  npm run format:check
  npm run lint
  npm run test:unit
  npm run test:coverage
  npm run test:e2e
  npm run build
  ```

  Confirm the existing Todo behavior remains unchanged and coverage thresholds still pass.

- [ ] **Step 2: Run Docker image and server gates.**

  ```bash
  docker build -t todo-web:local .
  docker run --rm -d --name todo-web-smoke -p 4173:4173 todo-web:local
  curl --fail http://127.0.0.1:4173/
  curl --fail -I http://127.0.0.1:4173/styles/app.css
  curl --fail http://127.0.0.1:4173/src/main.js
  test "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:4173/missing)" = 404
  docker rm -f todo-web-smoke
  ```

  Also inspect runtime content, non-root user, port, path traversal, and cleanup.

- [ ] **Step 3: Run Compose gates.**

  ```bash
  docker compose config
  TODO_WEB_PORT=4317 docker compose config
  docker compose up --build -d
  curl --fail http://127.0.0.1:4173/
  docker compose ps
  docker compose down
  ```

  Confirm exactly one service, no volume, correct mapping, HTTP readiness, and clean lifecycle.

- [ ] **Step 4: Run workflow static gates.**

  ```bash
  npm run validate:container-workflow
  npm run validate:container
  npm run format:check
  npm run lint
  git diff --check
  (cd docs && openspec validate containerize-todo-app)
  ```

  Confirm job graph, event gates, permissions, GHCR image name, SHA/latest tags, artifact transfer, and absence of long-lived credentials.

- [ ] **Step 5: Record evidence and update the authoritative ledger.**

  Keep a validation log outside tracked product files if desired. Only after every relevant command and acceptance scenario passes, change the corresponding unchecked entries in `docs/openspec/changes/containerize-todo-app/tasks.md` from `[ ]` to `[x]`. Do not add replacement tasks to this plan or silently mark Docker checks complete when Docker is unavailable.

### Task 14: Final verification handoff

**OpenSpec link:** all OpenSpec tasks 1.1–4.3

**Files:**
- Read: all files in `docs/openspec/changes/containerize-todo-app/`
- Modify: none unless a verification failure identifies a concrete implementation defect

**Interfaces:**
- Final review consumes the complete diff, OpenSpec artifacts, validation log, image/Compose evidence, and workflow static report.
- `openspec-verify-change` must report 14/14 tasks complete and no uncovered requirement.

- [ ] **Step 1: Re-read OpenSpec artifacts and compare implementation.**

  Verify every requirement and scenario in `specs/containerized-delivery/spec.md` has code/config and automated/static evidence. Check that no container persistence behavior was added and that host Python development behavior remains intact.

- [ ] **Step 2: Run final verification.**

  ```bash
  npm run format:check
  npm run lint
  npm run test:unit
  npm run test:coverage
  npm run test:e2e
  npm run build
  npm run validate:container-workflow
  npm run validate:container
  docker build -t todo-web:local .
  docker compose config
  (cd docs && openspec validate containerize-todo-app)
  git diff --check
  ```

  Confirm Docker/Compose HTTP smoke and cleanup were run in the same validation window; do not infer runtime success from static configuration.

- [ ] **Step 3: Run `$openspec-verify-change` for the change.**

  Use the repository’s OpenSpec root from `docs/`, inspect the report’s completeness/correctness/coherence dimensions, and stop for fixes if any Critical issue or uncovered scenario remains.

- [ ] **Step 4: Request final code review before branch handoff.**

  Review the complete implementation range against this plan and the OpenSpec delta. Resolve all Critical/Important findings, then rerun affected tests. Only after the final review is approved should the branch be handed to `superpowers:finishing-a-development-branch`.

## Execution Notes

- Start implementation from `base-ref` `b7005a6ac0f04b6f945f0210f69773527971b08b`.
- Keep commits small and tied to the OpenSpec task numbers; the OpenSpec ledger, not this plan, records authoritative task completion.
- Do not commit `node_modules/`, `dist/`, Playwright results, Docker image archives, or secrets. Add ignore rules for generated artifacts only when they are not already covered.
- The existing host-development path remains `npm run start` via Python; the container path uses Node `scripts/serve.mjs`. Do not conflate the two in Dockerfile or README.
- GHCR upload is a side effect outside local implementation; validate it statically and only execute a real publish in GitHub Actions under the guarded `main` push job.
