## Purpose

为单页网页提供简单可靠的任务管理能力，使用户能够创建、查看、完成和删除任务，并在浏览器刷新后继续使用之前保存的任务。

## ADDED Requirements

### Requirement: Create tasks

系统 MUST 提供一个任务文本输入框和“添加”按钮。用户提交非空任务文本时，系统 MUST 创建一个未完成任务并将其显示在任务列表中；创建后输入框 MUST 被清空。系统 MUST 忽略仅包含空白字符的输入，不得创建空任务。

#### Scenario: Add a non-empty task

- **WHEN** 用户输入“购买牛奶”并点击“添加”，或在输入框中按下 Enter
- **THEN** 列表新增一条显示“购买牛奶”的未完成任务，且输入框被清空

#### Scenario: Reject blank task text

- **WHEN** 用户提交空字符串或仅包含空白字符的输入
- **THEN** 列表不新增任务，已有任务保持不变

### Requirement: Display task items

系统 MUST 将每个任务显示为独立的一行，并展示任务文本、完成复选框和“删除”按钮。任务列表中的任务 MUST 使用稳定且彼此唯一的标识，以支持后续扩展任务属性。

#### Scenario: Render a task row

- **WHEN** 列表中存在一个任务
- **THEN** 用户能在同一任务行看到其文本、复选框和“删除”按钮

### Requirement: Complete and uncomplete tasks

系统 MUST 允许用户点击任务复选框切换完成状态。已完成任务 MUST 以明确的视觉样式区分，至少包含任务文本删除线；再次点击复选框 MUST 恢复未完成状态及其未完成样式。

#### Scenario: Mark task complete

- **WHEN** 用户勾选未完成任务的复选框
- **THEN** 该任务变为已完成，并显示删除线等完成样式

#### Scenario: Mark task incomplete

- **WHEN** 用户取消已完成任务的复选框
- **THEN** 该任务变为未完成，并移除完成样式

### Requirement: Delete tasks

系统 MUST 为每个任务提供“删除”按钮。用户点击该按钮后，系统 MUST 从列表中移除对应任务，且不得移除其他任务。

#### Scenario: Delete one task

- **WHEN** 用户点击某任务行的“删除”按钮
- **THEN** 对应任务不再显示，其他任务仍保留

### Requirement: Persist tasks in the browser

系统 MUST 使用浏览器 `localStorage` 保存任务文本、唯一标识和完成状态。创建、完成状态变更或删除后，系统 MUST 更新保存的数据；页面加载时 MUST 读取保存的数据并重建任务列表。

#### Scenario: Restore tasks after refresh

- **WHEN** 用户创建任务、改变其完成状态后刷新页面
- **THEN** 页面恢复该任务、其文本和最新完成状态

#### Scenario: Persist deletion

- **WHEN** 用户删除任务后刷新页面
- **THEN** 被删除的任务不会重新出现

#### Scenario: Recover from invalid stored data

- **WHEN** `localStorage` 中的任务数据不存在、无法解析或不是预期的任务列表
- **THEN** 系统以空列表启动且页面仍可正常使用

### Requirement: Keep the structure extensible

系统 MUST 将任务状态与列表操作、持久化和界面展示职责清晰分离，使未来添加筛选或优先级字段时无需重写现有核心任务操作。

#### Scenario: Extend task attributes

- **WHEN** 后续为任务增加筛选或优先级属性
- **THEN** 新属性可在任务模型和对应展示/操作层中加入，而不改变创建、完成、删除和持久化的基本行为
