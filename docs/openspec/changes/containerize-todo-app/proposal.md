## Why

当前 Todo Web 应用只能依赖宿主机 Node.js/Python 环境运行，缺少统一、可复现的部署方式和自动发布链路。增加 Docker Compose 运行配置以及分阶段 GitHub Actions 流程后，开发者可以用一致的容器启动应用，仓库也能在测试通过后自动构建并发布可部署镜像。

## What Changes

- 新增基于最小 Node.js 镜像的 Dockerfile，构建可运行的 Todo Web 静态应用镜像。
- 新增 Docker Compose 配置，以 Dockerfile 构建的镜像启动应用，并提供可配置的主机端口。
- 新增 GitHub Actions 工作流，按“编译 → 测试 → 镜像构建 → 镜像上传”的依赖顺序执行。
- 将镜像发布到 GitHub Container Registry（GHCR），使用仓库内置 `GITHUB_TOKEN` 完成认证。
- 补充容器构建、Compose 启动、工作流职责和本地验证命令文档。

## Capabilities

### New Capabilities

- `containerized-delivery`: 通过 Dockerfile、Docker Compose 和串联的 GitHub Actions 工作流提供可复现的容器运行与镜像发布能力。

### Modified Capabilities

无。

## Impact

影响容器构建文件、Compose 配置、GitHub Actions 工作流、静态应用运行入口和项目文档；不改变 Todo 的用户功能、`localStorage` 数据格式或应用后端（应用仍无后端）。需要 Docker Engine/Compose 和 GitHub Actions Docker/Node 工具支持，但不新增运行时服务端依赖。
