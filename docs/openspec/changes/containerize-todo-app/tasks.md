## 1. Container Image

- [x] 1.1 Add a `.dockerignore` that excludes `.git`, `node_modules`, `dist`, test results, local environment files, caches, OpenSpec artifacts, and agent work directories; verify `docker build` does not send excluded local content in the build context.
- [x] 1.2 Create a multi-stage root `Dockerfile` using a pinned minimal official Node.js Alpine LTS image; run `npm ci` and `npm run build` in the builder stage, copy only `dist/` into the runtime stage, and verify `docker build -t todo-web:local .` succeeds.
- [x] 1.3 Configure the runtime image to serve the built static application on container port `4173` without requiring host Node.js or Python; verify `docker run --rm -d --name todo-web-smoke -p 4173:4173 todo-web:local`, an HTTP request to `/`, and cleanup with `docker rm -f todo-web-smoke`.

## 2. Docker Compose Runtime

- [ ] 2.1 Create root `compose.yaml` with one `todo-web` service using `build: .` and image name `todo-web:local`; verify `docker compose config` resolves successfully and shows the expected build definition and service.
- [ ] 2.2 Add `${TODO_WEB_PORT:-4173}:4173` host-to-container port mapping and keep the service independent of host Node.js/Python; verify `TODO_WEB_PORT=4317 docker compose config` renders `4317:4173` and `docker compose up --build -d` serves the page on the configured host port.
- [ ] 2.3 Verify Compose lifecycle behavior and resource scope with `docker compose down`; confirm the application container is removed while unrelated containers/resources are not targeted.

## 3. GitHub Actions Delivery Workflow

- [ ] 3.1 Create `.github/workflows/container.yml` with separate `build`, `test`, `image`, and `publish` jobs; configure `test.needs: build`, `image.needs: test`, and `publish.needs: image`, and verify the workflow YAML parses and its dependency graph is statically correct.
- [ ] 3.2 Implement the `build` and `test` jobs for supported push/pull-request events; run the existing Node installation, format, lint, unit, coverage, E2E, and static build checks, and verify a failed prerequisite prevents dependent jobs from running.
- [ ] 3.3 Implement the `image` job to build the Docker image only after tests pass and produce commit-addressable tags; verify the job references the repository Dockerfile and metadata action/CLI configuration without publishing credentials.
- [ ] 3.4 Implement the `publish` job for permitted push events using GHCR (`ghcr.io/${{ github.repository }}`), `GITHUB_TOKEN`, and minimum `packages: write` permissions; verify pull-request workflows do not upload images and no long-lived secret is hard-coded.
- [ ] 3.5 Generate immutable commit-SHA tags and a stable default-branch tag such as `latest`; verify the workflow metadata configuration produces both the SHA tag and the default-branch alias under the repository-owned GHCR image.

## 4. Verification and Documentation

- [ ] 4.1 Add or update container/workflow validation scripts or fixtures for Dockerfile build, Compose config, HTTP smoke, workflow YAML/dependency checks, image content boundaries, and non-secret permissions; verify each check fails clearly when its required input is missing or invalid.
- [ ] 4.2 Update `README.md` with Docker prerequisites, local image build/run commands, Compose start/stop and port override commands, GHCR image naming/tagging, workflow trigger behavior, and required GitHub package permissions; verify every documented command matches the checked-in configuration.
- [ ] 4.3 Run the complete application and delivery validation sequence—`npm run format:check`, `npm run lint`, `npm run test:unit`, `npm run test:coverage`, `npm run test:e2e`, `npm run build`, `docker build -t todo-web:local .`, `docker compose config`, Compose HTTP smoke, and workflow YAML/dependency validation—and verify all containerized-delivery acceptance scenarios pass.
