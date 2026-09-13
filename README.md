# todo-web

一个无需后端的浏览器端单页 Todo 应用，支持创建、查看、完成、取消完成和删除任务，并在刷新页面后恢复任务状态。

## 前置条件

### 宿主机开发与测试

- Node.js：本次验证使用 Node.js `v22.23.2`。
- Python 3：本地静态服务器使用 `python3`；本次验证使用 Python `3.14.4`。
- Playwright 浏览器：安装依赖后执行 `npx playwright install chromium`，首次运行 E2E 测试前完成 Chromium 安装。

### 容器运行

容器方式需要可访问的 Docker Engine 和 Docker Compose（`docker compose` 插件）。容器镜像在构建阶段安装依赖并构建静态文件，在运行阶段由镜像内的 Node.js 服务器提供页面；因此运行容器不需要宿主机安装 Node.js 或 Python。

## 本地运行

在仓库根目录执行：

```bash
npm install
npm run start
```

然后打开 <http://127.0.0.1:4173/>。`npm run start` 是宿主机开发路径：它使用 Python 的静态文件服务器提供页面；停止服务器使用 `Ctrl-C`。

## 使用本地 Docker 镜像

在仓库根目录构建、启动并检查镜像：

```bash
docker build -t todo-web:local .
docker run --rm -d --name todo-web-smoke -p 4173:4173 todo-web:local
curl --fail http://127.0.0.1:4173/
docker rm -f todo-web-smoke
```

容器内由 Node.js 在端口 `4173` 提供已构建的 `dist/` 静态文件；这与上述使用宿主机 Python 的 `npm run start` 开发方式不同。

## 使用 Docker Compose

`compose.yaml` 只定义一个 `todo-web` 服务，默认将宿主机端口 `4173` 映射到容器端口 `4173`。在仓库根目录执行默认启动、检查和停止：

```bash
docker compose up --build -d
curl --fail http://127.0.0.1:4173/
docker compose ps
docker compose down
```

如需更改宿主机端口，设置 `TODO_WEB_PORT`。以下命令会以宿主机端口 `4317` 运行同一容器端口：

```bash
TODO_WEB_PORT=4317 docker compose up --build -d
curl --fail http://127.0.0.1:4317/
docker compose ps
docker compose down
```

此 Compose 配置不挂载 Docker volume，也不提供容器侧 Todo 持久化。任务仍仅由浏览器的 `localStorage` 保存；容器化不会改变现有浏览器存储行为。

## GHCR 镜像与 GitHub Actions

GitHub Actions 工作流位于 `.github/workflows/container.yml`，只响应目标为 `main` 的 push 和 pull request。它按 `build → test → image → publish` 的依赖顺序运行：

- 镜像名为 `ghcr.io/<owner>/<repo>`，在工作流中由 `ghcr.io/${{ github.repository }}` 生成。
- 每次构建生成不可变的完整提交标签 `sha-<commit>`。
- `latest` 只会在成功的 `main` push 中生成并发布。
- Pull request 会运行构建、测试和镜像构建/制品导出，但不会上传镜像。
- `main` push 在前序 job 成功后运行 publish，将 SHA 标签和 `latest` 上传到 GHCR。
- 发布使用 GitHub Actions 提供的短期 `GITHUB_TOKEN`，publish job 需要 `packages: write` 权限（同时保留 `contents: read`）；不需要也不应配置长期 PAT。

## 测试、构建与检查

以下命令均从仓库根目录执行：

```bash
npm run test:unit
npm run test:coverage
npx playwright install chromium
npm run test:e2e
npm run build
npm run format:check
npm run lint
npm run check
```

- `npm run test:unit` 运行 Node.js 内置测试，覆盖任务模型和存储适配器。
- `npm run test:coverage` 运行相同单元测试并输出覆盖率报告；Node.js 会以 90% 作为行、分支和函数覆盖率的最低门槛。
- `npx playwright install chromium` 安装 Playwright 使用的 Chromium 浏览器；在新环境中只需首次执行。
- `npm run test:e2e` 使用 Playwright 启动或复用本地静态服务器，验证真实浏览器中的页面、交互、刷新恢复和窄视口可用性。
- `npm run build` 将 `index.html`、`src/` 和 `styles/` 复制到可部署的静态目录 `dist/`。
- `npm run format:check` 使用 Prettier 检查项目源代码、测试、配置和 README 的格式；生成文件和 OpenSpec/技能工作流产物会被忽略。
- `npm run lint` 使用 ESLint 检查原生 ES 模块、浏览器代码、Node.js 脚本、测试和 Playwright 配置。
- `npm run check` 顺序执行格式检查、Lint、单元测试和静态构建检查。

### 容器和工作流验证

以下命令验证已签入的 Compose、容器和 GitHub Actions 契约：

```bash
npm run validate:compose
npm run test:container-smoke
npm run test:compose-runtime
npm run validate:container-workflow
npm run test:container-workflow
npm run test:container-validation
npm run validate:container
```

`npm run validate:container` 先执行静态 Dockerfile、`.dockerignore`、Compose 和 workflow 检查，再要求可访问的 Docker Engine/Compose 执行镜像构建、`docker compose config`、独立容器 HTTP smoke 和 Compose 生命周期 smoke；Docker 不可访问时该命令会失败而不是跳过运行时验证。

## 模块职责

- `src/todo/model.js`：纯任务模型与列表操作，包括创建、完成状态切换和按稳定 ID 删除；不依赖 DOM 或浏览器存储。
- `src/todo/storage.js`：负责版本化 `localStorage` 数据的读取、校验、规范化、序列化和保存；不负责界面渲染。
- `src/todo/ui.js`：负责任务行渲染和语义化事件绑定；任务文本使用 `textContent` 写入，HTML-like 输入会按普通文本显示。
- `src/main.js`：组装模块，维护当前内存状态，在每次创建、完成状态变更或删除后重新渲染并保存。
- `styles/app.css`：负责单页布局、完成状态删除线以及窄视口下的换行和纵向表单布局。

## 浏览器存储行为

任务保存在当前浏览器的 `localStorage`，固定 key 为 `todo-app.tasks`。存储值是版本一 envelope：

```json
{
  "version": 1,
  "tasks": [
    {
      "id": "stable-id",
      "text": "购买牛奶",
      "completed": false
    }
  ]
}
```

读取时，缺失数据、无法解析的 JSON、不支持的版本或错误的 envelope 会安全地恢复为空列表；单条无效任务记录会被丢弃，同一数组中的有效任务仍可保留。读取或写入 `localStorage` 失败时，页面不会崩溃：当前会话继续使用内存状态，并显示非阻塞的状态提示。写入失败不会撤销已经完成的当前页面操作。

## 非目标与扩展边界

本版本明确不实现：

- 用户账户、登录、跨设备同步；
- 服务端 API、数据库或后端持久化；
- 任务筛选、优先级、编辑、排序和批量操作。

任务模型、存储适配器和 UI 已按职责分离。未来可在保持创建、完成、删除和持久化基本行为的前提下增加筛选或优先级字段；这些是扩展边界，不是当前已实现的产品功能。
