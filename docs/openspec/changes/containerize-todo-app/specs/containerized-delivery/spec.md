## Purpose

为 Todo Web 应用提供可复现的容器化交付路径，使开发者能够通过 Docker Compose 启动应用，并使 GitHub Actions 在验证通过后构建和发布可部署镜像。

## ADDED Requirements

### Requirement: Build a runnable application image

系统 MUST 提供仓库根目录下的 `Dockerfile`，以官方最小 Node.js 基础镜像为基础构建应用镜像。构建上下文 MUST 只包含运行应用所需的静态页面、源码、样式和必要配置，不得将依赖缓存、测试结果、版本控制元数据或本地敏感配置打入镜像。构建出的镜像 MUST 能在容器内提供 Todo Web 页面。

#### Scenario: Build the image locally

- **WHEN** 用户在仓库根目录执行 `docker build -t todo-web:local .`
- **THEN** Docker 构建成功，并生成名为 `todo-web:local` 的镜像

#### Scenario: Run the built image

- **WHEN** 用户以 `todo-web:local` 启动容器并访问其 HTTP 服务端口
- **THEN** 用户收到 Todo Web 页面，且页面核心交互仍可使用

### Requirement: Run the application with Docker Compose

系统 MUST 提供 Compose 配置，使用步骤一 Dockerfile 构建的应用镜像运行 Todo Web。Compose 配置 MUST 暴露应用 HTTP 端口，默认端口应可通过环境变量覆盖，并 MUST 保持容器端口与宿主机端口映射清晰。Compose 配置不得依赖宿主机 Node.js 或 Python 才能启动应用。

#### Scenario: Start with Docker Compose

- **WHEN** 用户执行 `docker compose up --build -d`
- **THEN** Compose 成功构建并启动应用服务，且可通过配置的宿主机端口访问 Todo Web 页面

#### Scenario: Validate Compose configuration

- **WHEN** 用户执行 `docker compose config`
- **THEN** Compose 配置解析成功，服务使用本变更的应用镜像构建定义并包含有效端口映射

#### Scenario: Stop the Compose application

- **WHEN** 用户执行 `docker compose down`
- **THEN** 应用容器被停止并移除，且 Compose 不删除用户未声明为本应用资源的其他容器

### Requirement: Execute CI stages in dependency order

系统 MUST 提供 GitHub Actions 工作流，至少包含独立的编译、测试、镜像构建和镜像上传阶段。阶段依赖关系 MUST 为：测试依赖编译成功，镜像构建依赖测试成功，镜像上传依赖镜像构建成功；任一前置阶段失败时，其后置阶段 MUST 不执行。

#### Scenario: Successful workflow chain

- **WHEN** 工作流在受支持的 push 或 pull request 事件上触发，且编译、测试、镜像构建均成功
- **THEN** 阶段按编译 → 测试 → 镜像构建 → 镜像上传顺序完成，且镜像被发布到 GHCR

#### Scenario: Failed prerequisite blocks downstream stage

- **WHEN** 编译或测试阶段失败
- **THEN** 依赖它的后续镜像构建和镜像上传阶段不执行，工作流报告失败

#### Scenario: Authenticate registry upload securely

- **WHEN** 镜像上传阶段向 GHCR 发布镜像
- **THEN** 工作流使用 GitHub Actions 提供的短期 `GITHUB_TOKEN` 和最小化的 `packages: write` 权限，不在仓库文件或日志中硬编码长期凭据

### Requirement: Publish a traceable image

系统 MUST 为上传的镜像提供可追溯标签，至少包含与 Git 提交或工作流运行关联的不可变标签，并在默认分支的发布流程中提供稳定的分支标签（例如 `latest`）。上传目标 MUST 使用仓库归属的 GHCR 镜像名称，并支持在工作流中安全引用仓库和提交信息。

#### Scenario: Tag image from a commit

- **WHEN** 镜像构建和上传阶段处理一次提交
- **THEN** 推送的镜像至少包含一个基于该提交 SHA 的不可变标签，并可由该标签定位对应源代码

#### Scenario: Tag default branch image

- **WHEN** 默认分支上的工作流成功完成镜像构建
- **THEN** GHCR 中存在该应用的稳定分支标签，供部署方引用
