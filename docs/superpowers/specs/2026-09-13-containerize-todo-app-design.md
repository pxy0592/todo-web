---
change: containerize-todo-app
role: technical-design
canonical_spec: openspec
---

# Containerize Todo App Technical Design

## 1. Design Scope and Source of Truth

This document defines the implementation approach for `containerize-todo-app`. The OpenSpec proposal and delta spec remain the source of truth for user-visible behavior; this document elaborates implementation, verification, security, and failure boundaries without redefining those requirements. The capability contract is `docs/openspec/changes/containerize-todo-app/specs/containerized-delivery/spec.md`.

The change adds a Docker image, Docker Compose runtime, and a GitHub Actions delivery workflow. It does not change Todo behavior, browser `localStorage` format, or the existing host-development path. Container-side data persistence is explicitly out of scope: no backend, database, Docker volume, or container filesystem data store is introduced. Existing browser `localStorage` behavior may continue when the same browser origin is used, but persistence across container lifecycle is not a container acceptance target.

## 2. Confirmed Runtime Architecture

### 2.1 Native static server for the container

The existing `npm run start` path uses Python's static server for host development and remains unchanged. The container must not require host Python or host Node.js. Because the runtime image is a minimal Node Alpine image and Node does not provide a built-in static-server CLI, add a small `scripts/serve.mjs` entry point using Node's standard `http` and filesystem APIs.

The server contract is:

- listen on `0.0.0.0` so Docker port forwarding can reach it;
- read `PORT` from the environment and default to `4173`;
- serve only the runtime `dist/` directory;
- map `/` to `index.html`;
- provide basic `Content-Type` values for HTML, CSS, JavaScript, JSON, images, and other known static assets;
- return 404 for missing files and never expose a directory listing;
- normalize URL paths and reject traversal attempts before resolving filesystem paths;
- allow only regular files beneath the static root;
- exit cleanly on SIGTERM/SIGINT.

The server is intentionally not a general production proxy: no API routing, upload handling, compression, TLS, dynamic rendering, or directory browsing is added. This keeps the runtime surface small and makes its limits explicit.

## 3. Docker Image Design

### 3.1 Multi-stage Dockerfile

Use a pinned official Node.js Alpine LTS tag, for example `node:22-alpine`, and upgrade it deliberately when compatibility verification is available. The Dockerfile has two stages:

```text
builder: node:22-alpine
  copy package.json package-lock.json
  npm ci
  copy index.html src/ styles/ scripts/build.mjs
  npm run build

runtime: node:22-alpine
  copy dist/ -> /app/dist/
  copy scripts/serve.mjs -> /app/serve.mjs
  expose 4173
  run as non-root
  node /app/serve.mjs
```

The builder may contain development dependencies temporarily, but the runtime must contain only the static output and server entry point needed to serve it. The runtime image must not include `node_modules/`, tests, source-control metadata, OpenSpec files, agent work directories, `.env` files, or the build script. Set `WORKDIR /app`, use a writable boundary only where Node requires it, and avoid privileged mode or host mounts.

The build must run `npm ci` from the lockfile and then the existing `npm run build`. The existing build output is static and is copied without bundling or rewriting module paths. The final image is tagged locally as `todo-web:local` by the Compose configuration and local verification commands.

### 3.2 Build context boundary

Add a root `.dockerignore` covering at least:

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

The ignore file prevents local dependencies, generated output, credentials, and planning/agent artifacts from entering the context. Dockerfile `COPY` instructions should still name only the required inputs rather than relying solely on the ignore file.

## 4. Docker Compose Contract

Create root `compose.yaml` with exactly one application service:

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

The service builds from the repository Dockerfile, publishes the application port, and does not mount source code or add external services. The host port is configurable while the container port remains fixed at `4173`; this keeps the container/server contract stable while allowing local port conflicts to be resolved.

Validation must include:

```bash
docker compose config
TODO_WEB_PORT=4317 docker compose config
docker compose up --build -d
curl --fail http://127.0.0.1:4173/
docker compose ps
docker compose down
```

`docker compose down` must remove only the resources declared by this Compose project. No volume is declared, because this change does not provide container data persistence. The Compose path must work without a host Node.js or Python runtime once Docker/Compose is installed.

## 5. GitHub Actions Delivery Architecture

### 5.1 Event and permission policy

Use a workflow such as `.github/workflows/container.yml` triggered by pull requests targeting `main` and pushes to `main`:

```yaml
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
```

Set a conservative workflow-level permission such as `contents: read`. Only the `publish` job elevates permissions to:

```yaml
permissions:
  contents: read
  packages: write
```

The workflow uses the short-lived `${{ secrets.GITHUB_TOKEN }}` for GHCR authentication. No PAT, password, or long-lived registry credential is stored in YAML, source, or logs.

### 5.2 Four dependent jobs

The workflow contains four distinct jobs with explicit dependencies:

```text
build -> test -> image -> publish
```

#### `build`

- checkout the triggering commit;
- install the configured Node.js version;
- run `npm ci`;
- run `npm run build`;
- upload the resulting `dist/` as an artifact for traceability or downstream checks.

#### `test`

- declare `needs: build`;
- checkout the same commit and install dependencies;
- install the Playwright Chromium browser required by the existing E2E suite;
- run format check, lint, unit tests, coverage, E2E, and static build checks;
- optionally download and assert the build artifact exists.

A failed build prevents this job and all downstream jobs from running.

#### `image`

- declare `needs: test`;
- configure Docker Buildx and image metadata;
- generate the repository image name `ghcr.io/${{ github.repository }}`;
- build the Dockerfile with commit-addressable tags;
- do not push from this job;
- export the built image as a Docker/OCI artifact for the publish runner.

Exporting the image is deliberate: GitHub-hosted jobs may use different runners, so a local Docker daemon image cannot be assumed to exist in `publish`.

#### `publish`

- declare `needs: image`;
- run only for an allowed `push` to `main`, for example with an explicit event/ref condition;
- download the image artifact and load it into Docker;
- log in to GHCR using `GITHUB_TOKEN`;
- push the exact image built by `image`, not a second rebuild;
- expose only `contents: read` and `packages: write` permissions.

A pull request may run through `image` for build validation, but it must skip login and image upload. Build/test/image failures block all later jobs through `needs`.

### 5.3 Image metadata

Use `docker/metadata-action` or equivalent deterministic metadata logic. Every built image must include an immutable commit SHA tag, for example:

```text
ghcr.io/${{ github.repository }}:sha-${{ github.sha }}
```

A successful default-branch push also receives a stable convenience tag such as `latest`. The SHA tag is the source-to-image traceability anchor; `latest` is a mutable alias and must not replace SHA tags. Tags generated for pull requests may be used only for validation and must not be uploaded.

## 6. Failure Boundaries and Security Controls

| Risk or failure | Required handling |
| --- | --- |
| Missing/invalid Docker build input | `.dockerignore` and Dockerfile checks fail the build clearly before image publication. |
| Alpine/build dependency incompatibility | Use `npm ci` from the lockfile and run the existing build in CI and locally. |
| Runtime static-server path traversal | Normalize URL paths, reject traversal, constrain resolved paths to `dist/`, and return 404. |
| Runtime image contains development material | Inspect image contents and assert only `dist/` plus `serve.mjs` runtime assets are present. |
| Container binds only to localhost | Bind the Node server to `0.0.0.0` and verify through published Docker port. |
| Compose port collision | Support `TODO_WEB_PORT` while keeping target port 4173 stable. |
| GHCR authentication failure | Fail the publish job without affecting existing images; never fall back to hard-coded credentials. |
| Pull request accidentally publishes | Restrict publish to allowed push/ref conditions and statically test the condition. |
| Cross-runner image loss | Export/load the image artifact between `image` and `publish`; do not assume a shared daemon. |
| Unwanted data-persistence promise | Declare no volumes/backends; do not use container filesystem state as Todo storage. |

The image-content check must verify that tests, `.git`, docs, OpenSpec artifacts, agent data, `.env` files, and dependency caches are absent. The workflow check must verify the job graph, permissions, registry name, token reference, tags, and publish condition without printing secrets.

## 7. Verification Strategy

### 7.1 Local container checks

Run the existing application gates first:

```bash
npm run format:check
npm run lint
npm run test:unit
npm run test:coverage
npm run test:e2e
npm run build
```

Then validate the image and server:

```bash
docker build -t todo-web:local .
docker run --rm -d --name todo-web-smoke -p 4173:4173 todo-web:local
curl --fail http://127.0.0.1:4173/
curl --fail -I http://127.0.0.1:4173/styles/app.css
curl --fail http://127.0.0.1:4173/src/main.js
test "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:4173/missing)" = 404
docker rm -f todo-web-smoke
```

Also test a traversal-shaped request and inspect the runtime filesystem without exposing secrets:

```bash
docker run --rm todo-web:local find /app -maxdepth 2 -type f | sort
```

The check must establish HTTP 200 for the page/resources, basic content types, 404 for missing files, traversal rejection, and clean container shutdown.

### 7.2 Compose checks

Validate both default and overridden ports, start the service, check `docker compose ps`, perform HTTP smoke, and stop it. Confirm no volume is declared and no unrelated Compose resources are touched.

### 7.3 Workflow static checks

Add a small parser/fixture-based validation or use actionlint where available. Assert:

```text
jobs.build exists
jobs.test.needs == build
jobs.image.needs == test
jobs.publish.needs == image
```

Also assert the event/ref gating, GHCR image name, SHA and default-branch tags, minimal permissions, `GITHUB_TOKEN` usage, absence of long-lived credentials, and image-artifact transfer.

### 7.4 Final acceptance sequence

The complete delivery check is:

```text
npm format/lint/test/coverage
→ npm build
→ docker build
→ docker run HTTP smoke
→ docker compose config
→ Docker Compose start/status/HTTP smoke/down
→ workflow YAML/dependency/permission/tag validation
```

The existing Todo tests remain authoritative for Todo functionality; this change adds only container and delivery verification around the already-built static application.

## 8. Implementation Sequence

Implement in this dependency order:

1. Add `.dockerignore` and the Node native `scripts/serve.mjs`, with focused tests for content serving, 404 behavior, content types, and traversal rejection.
2. Add the multi-stage `Dockerfile`; build locally and inspect runtime contents.
3. Add `compose.yaml`; validate interpolation, start/status, HTTP smoke, and cleanup.
4. Add `.github/workflows/container.yml`; statically validate job dependencies, event gates, permissions, metadata, and artifact transfer.
5. Add or update validation fixtures/scripts and README documentation.
6. Run the complete application and delivery validation sequence and record results before marking all OpenSpec tasks complete.

No OpenSpec delta-spec amendment is required from the confirmed design: the existing capability spec already covers image build/run, Compose lifecycle, CI dependency order, secure GHCR publishing, and traceable tags. No container data-persistence scenario is added.
