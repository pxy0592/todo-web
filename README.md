# todo-web

一个无需后端的浏览器端单页 Todo 应用，支持创建、查看、完成、取消完成和删除任务，并在刷新页面后恢复任务状态。

## 前置条件

- Node.js：本次验证使用 Node.js `v22.23.2`。
- Python 3：本地静态服务器使用 `python3`；本次验证使用 Python `3.14.4`。
- Playwright 浏览器：安装依赖后执行 `npx playwright install chromium`，首次运行 E2E 测试前完成 Chromium 安装。

## 本地运行

在仓库根目录执行：

```bash
npm install
npm run start
```

然后打开 <http://127.0.0.1:4173/>。`npm run start` 使用 Python 的静态文件服务器提供页面；停止服务器使用 `Ctrl-C`。

## 测试、构建与检查

以下命令均从仓库根目录执行：

```bash
npm run test:unit
npm run test:coverage
npx playwright install chromium
npm run test:e2e
npm run build
npm run check
```

- `npm run test:unit` 运行 Node.js 内置测试，覆盖任务模型和存储适配器。
- `npm run test:coverage` 运行相同单元测试并输出覆盖率报告；本实现的模型与存储单元覆盖率达到至少 90%。
- `npx playwright install chromium` 安装 Playwright 使用的 Chromium 浏览器；在新环境中只需首次执行。
- `npm run test:e2e` 使用 Playwright 启动或复用本地静态服务器，验证真实浏览器中的页面、交互、刷新恢复和窄视口可用性。
- `npm run build` 将 `index.html`、`src/` 和 `styles/` 复制到可部署的静态目录 `dist/`。
- `npm run check` 顺序执行单元测试和静态构建检查。

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

读取时，缺失数据、无法解析的 JSON、不支持的版本、错误的 envelope 或无效任务记录都会安全地恢复为空列表；同一数组中的有效任务仍可保留。读取或写入 `localStorage` 失败时，页面不会崩溃：当前会话继续使用内存状态，并显示非阻塞的状态提示。写入失败不会撤销已经完成的当前页面操作。

## 非目标与扩展边界

本版本明确不实现：

- 用户账户、登录、跨设备同步；
- 服务端 API、数据库或后端持久化；
- 任务筛选、优先级、编辑、排序和批量操作。

任务模型、存储适配器和 UI 已按职责分离。未来可在保持创建、完成、删除和持久化基本行为的前提下增加筛选或优先级字段；这些是扩展边界，不是当前已实现的产品功能。
