## Context

当前 Todo Web 是原生 ES modules 静态应用，使用 Python 静态服务器进行本地开发，生产构建由 `scripts/build.mjs` 生成 `dist/`。本变更需要在不改变页面行为、`localStorage` 数据契约和现有测试工具链的前提下，增加容器运行与镜像交付能力。动机和范围见 `proposal.md`，行为契约见 `specs/containerized-delivery/spec.md`。

## Goals / Non-Goals

**Goals:**

- 构建一个仅包含静态应用运行所需内容的轻量 Node 镜像。
- 通过 Compose 一条命令构建、启动和停止应用，并支持宿主机端口配置。
- 让 GitHub Actions 以明确的 job 依赖关系执行编译、测试、镜像构建和 GHCR 发布。
- 以提交 SHA 等不可变标签关联源代码和镜像。

**Non-Goals:**

- 不改变 Todo 功能、前端框架或 `localStorage` 格式。
- 不增加后端、数据库、编排平台部署、自动生产环境部署或多架构发布矩阵。
- 不把 Docker/Compose 运行时凭据写入仓库。

## Decisions

1. **采用多阶段、最小官方 Node Alpine 镜像。** 构建阶段使用 Node 镜像执行 `npm ci` 和现有 `npm run build`；运行阶段只复制 `dist/`，使用 Node 内置静态服务器提供页面。相比单阶段镜像，多阶段方案不携带源码、开发依赖和测试工具；相比 Nginx，Node 运行阶段与既有 Node 工具链一致且不需引入第二个运行时家族。基础镜像版本必须固定到明确的 LTS Alpine tag，并在后续升级时通过验证确认兼容性。

2. **Docker 构建上下文使用 `.dockerignore`。** 排除 `.git`、`node_modules`、`dist`、测试结果、开发缓存、环境文件和 OpenSpec/代理工作目录，避免泄露本地内容并减少上下文。Dockerfile 只复制 `package*.json` 安装依赖，再复制构建所需源码、页面、样式和脚本。

3. **Compose 使用 build 与显式端口变量。** `compose.yaml` 定义单一 `todo-web` 服务，`build: .` 与镜像名 `todo-web:local` 保持一致，使用 `${TODO_WEB_PORT:-4173}:4173` 映射宿主端口。服务不挂载源码、不要求宿主 Node/Python，并通过 `docker compose config` 验证插值结果。

4. **CI 使用四个串联 job。** `.github/workflows/container.yml` 定义 `build`、`test`、`image`、`publish` 四个 job：`test.needs: build`，`image.needs: test`，`publish.needs: image`。编译 job 执行依赖安装和 `npm run build`；测试 job 执行格式、lint、单元、覆盖率和 E2E 所需的既有验证；镜像 job 构建并加载/导出带 SHA 标签的镜像；发布 job 使用 `docker/login-action` 或官方 Docker CLI 方式登录 GHCR，并设置 `packages: write` 权限。

5. **镜像元数据和凭据遵循 GitHub 官方语义。** 使用 `docker/metadata-action` 生成 `ghcr.io/${{ github.repository }}` 镜像名及 SHA、分支和默认分支稳定标签；发布 job 只在允许发布的 push 事件执行，pull request 只编译、测试和验证镜像，不上传。使用 `${{ secrets.GITHUB_TOKEN }}`，不创建或保存长期 PAT。

6. **验证分层。** 本地验证依次覆盖 `docker build`、`docker run` HTTP smoke、`docker compose config`、Compose 启停和镜像内容边界；CI YAML 静态检查使用 actionlint（若环境可用）或 YAML 解析器，并对 job `needs` 和权限进行结构断言。Docker 验证不替代既有 Node/Playwright 验证。

## Risks / Trade-offs

- [Alpine/native dependency compatibility] → 构建阶段使用 `npm ci` 与当前 lockfile，运行阶段不安装开发依赖；在 CI 和本地执行完整构建。
- [Node static server is not a hardened production proxy] → 本变更目标是可复现容器运行；README 明确其适用范围，生产反向代理/TLS 留在非目标范围。
- [GHCR 权限或仓库可见性设置错误] → job 显式设置最小 `packages: write` 权限，仅 push 事件发布，并在 workflow 中使用内置 token。
- [标签漂移] → 每次镜像强制包含 commit SHA 标签；稳定标签仅作为默认分支便利别名。
- [Docker daemon/action runner 差异] → 使用官方 Docker actions 和标准 CLI，先在本地执行 Compose 配置与启动 smoke，再在 workflow 中复用同一命令。

## Migration Plan

新增文件可直接部署，无数据迁移。开发者执行 `docker compose up --build -d` 即可启动；旧的宿主机 `npm run start` 方式继续保留。回滚时移除 Compose/Docker/Workflow 文件即可，不影响浏览器已有 `localStorage` 数据。首次启用 GHCR 时需确认仓库允许 Actions 写入 packages，之后由 `GITHUB_TOKEN` 完成认证。

## Open Questions

- 是否需要在默认分支以外发布稳定标签，留待后续产品发布策略确定；当前设计只为默认分支生成稳定标签。
