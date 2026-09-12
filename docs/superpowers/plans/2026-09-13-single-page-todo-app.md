---
change: single-page-todo-app
design-doc: docs/superpowers/specs/2026-09-13-single-page-todo-app-design.md
base-ref: bf95910a564bc74ce2ba71df1eab258c29f8b1af
---

# Single-Page Todo App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Implement the OpenSpec-defined browser-only Todo application with task creation, completion, deletion, versioned `localStorage` persistence, accessible single-page UI, and automated acceptance coverage.

**Architecture:** Use native HTML, CSS, and ES modules. Keep pure task operations in `src/todo/model.js`, versioned storage and validation in `src/todo/storage.js`, DOM rendering and delegated event binding in `src/todo/ui.js`, and state orchestration in `src/main.js`. Use Node's built-in test runner for model/storage tests and Playwright for real-browser DOM, storage, and reload scenarios.

**Tech Stack:** Native HTML/CSS/ES modules, Node.js built-in `node:test` and coverage, Playwright for browser integration, Python's standard HTTP server for local static serving, and a small Node build-check/copy script.

**Spec:** `docs/openspec/changes/single-page-todo-app/specs/todo-management/spec.md`; design: `docs/superpowers/specs/2026-09-13-single-page-todo-app-design.md`; task source of truth: `docs/openspec/changes/single-page-todo-app/tasks.md`.

## Global Constraints

- OpenSpec is the behavioral source of truth; do not add behavior outside `docs/openspec/changes/single-page-todo-app/specs/todo-management/spec.md`.
- Every plan task below links to its corresponding OpenSpec task number; do not renumber or replace the OpenSpec checklist.
- Use native HTML, CSS, and JavaScript ES modules; do not add a UI framework or application build framework.
- Keep model, storage, UI, and composition responsibilities separated; UI must not call `localStorage` directly.
- Persist `{ "version": 1, "tasks": [...] }` under `todo-app.tasks`; task records contain `id`, `text`, and boolean `completed`.
- Mutations use stable task IDs, return new arrays, and do not rely on row or array indexes.
- Trim task input and reject empty or whitespace-only values; render user text with `textContent`, never interpolated `innerHTML`.
- Storage read/write errors must not crash the page or roll back current in-memory state; surface them as non-blocking status messages.
- Every OpenSpec scenario needs automated test evidence; model and storage unit coverage must reach at least 90%.
- Do not implement filtering, priority, editing, sorting, bulk actions, accounts, synchronization, backend APIs, or databases in this change.

## File Map

- Create `package.json`: project scripts and development dependencies only; no runtime framework.
- Create `package-lock.json`: reproducible dependency resolution after installing the selected dev dependencies.
- Create `index.html`: semantic Todo page shell, labelled form, task list, empty state, status region, and module entry point.
- Create `src/main.js`: dependency composition, single in-memory task state, mutation flow, initial load, rendering, persistence, and status handling.
- Create `src/todo/model.js`: pure task creation, addition, completion toggle, deletion, input normalization, and ID handling.
- Create `src/todo/storage.js`: version-one envelope serialization, validation, duplicate-ID filtering, and injected storage adapter operations.
- Create `src/todo/ui.js`: safe DOM rendering, completed-state attributes/classes, accessible controls, empty state, and delegated event callbacks.
- Create `styles/app.css`: readable responsive layout, row controls, completed deletion visual, and narrow-viewport behavior.
- Create `tests/helpers/memory-storage.js`: deterministic `getItem`/`setItem` storage fake with injectable failures.
- Create `tests/todo-model.test.js`: model behavior, immutability, and ID tests using deterministic ID factories.
- Create `tests/todo-storage.test.js`: persistence envelope, normalization, invalid data, duplicate IDs, and storage exception tests.
- Create `tests/todo-ui.spec.js`: Playwright browser scenarios for controls, interactions, safe text rendering, viewport behavior, and reload persistence.
- Create `playwright.config.js`: local web server command, test directory, isolated browser context defaults, and timeout settings.
- Create `scripts/build.mjs`: clean and copy static production files into `dist/` without bundling or rewriting module paths.
- Modify `README.md`: prerequisites, local serve/test/build commands, storage key/format, and extension boundaries.

## Implementation Tasks

### Task 1: Establish the native web project and test commands

**OpenSpec link:** `tasks.md` 1.1 and 1.2

**Files:**
- Create: `package.json`
- Create: `package-lock.json`
- Create: `index.html`
- Create: `styles/app.css`
- Create: `playwright.config.js`
- Create: `scripts/build.mjs`
- Create: `tests/smoke.test.js`
- Modify: none

**Interfaces:**
- Produces npm scripts: `start`, `test:unit`, `test:coverage`, `test:e2e`, `build`, and `check`.
- `start` serves the repository root on a documented local port, such as `4173`.
- `build` creates `dist/` containing `index.html`, `src/`, and `styles/` as static deployable files.
- Playwright's web server starts the same static server used by local development.

- [ ] **Step 1: Add the project manifest and scripts.**

  Define ES module execution and scripts with concrete commands:

  ```json
  {
    "type": "module",
    "scripts": {
      "start": "python3 -m http.server 4173",
      "test:unit": "node --test tests/todo-*.test.js tests/smoke.test.js",
      "test:coverage": "node --experimental-test-coverage --test tests/todo-*.test.js tests/smoke.test.js",
      "test:e2e": "playwright test",
      "build": "node scripts/build.mjs",
      "check": "npm run test:unit && npm run build"
    },
    "devDependencies": {
      "@playwright/test": "^1.55.0"
    }
  }
  ```

  Use the repository's installed Node version when resolving the final Playwright version; keep the selected version in the lockfile.

- [ ] **Step 2: Add the static shell and build copy script.**

  Create a minimal `index.html` with a `<main>` application root and module entry reference, and create `scripts/build.mjs` that removes `dist/`, creates its directories, and copies `index.html`, `src/`, and `styles/`. The build script must fail on missing required inputs and must not copy `node_modules/` or tests.

- [ ] **Step 3: Add the initial smoke test and Playwright configuration.**

  The smoke test should assert a small deterministic project invariant, such as the presence of `index.html` and `src/main.js` after setup. Configure Playwright with `testDir: './tests'`, `webServer.command: 'python3 -m http.server 4173'`, `baseURL: 'http://127.0.0.1:4173'`, and a bounded startup timeout.

- [ ] **Step 4: Install dependencies and run the setup checks.**

  Run:

  ```bash
  npm install
  npm run test:unit
  npm run build
  ```

  Expected: dependency installation succeeds, the smoke test passes, and `dist/index.html` plus copied source/style directories exist.

### Task 2: Implement the pure task model

**OpenSpec link:** `tasks.md` 2.1

**Files:**
- Create: `src/todo/model.js`
- Create: `tests/todo-model.test.js`
- Modify: `package.json` only if test script globbing needs the final test path

**Interfaces:**
- `createTask(text, idFactory) -> { id: string, text: string, completed: false }`.
- `addTask(tasks, text, idFactory) -> Task[]`.
- `toggleTask(tasks, taskId) -> Task[]`.
- `removeTask(tasks, taskId) -> Task[]`.
- All list operations leave the input array and task objects unchanged.

- [ ] **Step 1: Write failing model tests.**

  Use deterministic IDs and cover the OpenSpec creation, blank-input, completion, deletion, and extensibility foundations:

  ```js
  test('trims and creates an incomplete task with an injected id', () => {
    const task = createTask('  Buy milk  ', () => 'task-1');
    assert.deepEqual(task, { id: 'task-1', text: 'Buy milk', completed: false });
  });

  test('rejects whitespace-only text without changing the list', () => {
    assert.deepEqual(addTask([], ' \t\n', () => 'unused'), []);
  });

  test('toggles and removes by stable id without mutating input', () => {
    const original = [{ id: 'a', text: 'A', completed: false }, { id: 'b', text: 'B', completed: false }];
    const completed = toggleTask(original, 'a');
    const remaining = removeTask(completed, 'a');
    assert.equal(original[0].completed, false);
    assert.deepEqual(remaining, [{ id: 'b', text: 'B', completed: false }]);
  });
  ```

  Add tests for unknown IDs, unique injected IDs, preserving unrelated tasks, and both completion transitions.

- [ ] **Step 2: Run the focused model tests and verify failure.**

  Run:

  ```bash
  node --test tests/todo-model.test.js
  ```

  Expected: FAIL because `src/todo/model.js` does not yet export the required operations.

- [ ] **Step 3: Implement the minimal pure model.**

  Normalize with `text.trim()`, return `null` or a clearly documented rejected result from `createTask` for blank text, and make `addTask` preserve the original list when creation is rejected. Use `map` for toggling, `filter` for removal, and return unchanged-equivalent arrays for unknown IDs without throwing.

- [ ] **Step 4: Run model tests and coverage.**

  Run:

  ```bash
  node --test tests/todo-model.test.js
  node --experimental-test-coverage --test tests/todo-model.test.js
  ```

  Expected: all model tests pass and model statement/branch coverage meets the project 90% target.

### Task 3: Implement versioned storage and validation

**OpenSpec link:** `tasks.md` 2.2

**Files:**
- Create: `src/todo/storage.js`
- Create: `tests/helpers/memory-storage.js`
- Create: `tests/todo-storage.test.js`

**Interfaces:**
- `STORAGE_KEY -> 'todo-app.tasks'`.
- `loadTasks(storage) -> { tasks: Task[], warning?: string }` or the equivalent documented result used consistently by `main.js`.
- `saveTasks(storage, tasks) -> { ok: true } | { ok: false, warning: string }`.
- `storage` exposes `getItem(key)` and `setItem(key, value)`.
- Valid persisted envelope is `{ version: 1, tasks: Array<Task> }`.

- [ ] **Step 1: Write storage tests against an in-memory fake.**

  Include cases for missing key, valid version-one data, malformed JSON, invalid envelope/version/tasks shape, invalid individual records, mixed valid and invalid records, duplicate IDs, correct writes, and thrown `getItem`/`setItem` errors. Example:

  ```js
  test('keeps valid records and drops invalid and duplicate records', () => {
    const storage = memoryStorage({
      'todo-app.tasks': JSON.stringify({ version: 1, tasks: [
        { id: 'a', text: 'A', completed: false },
        { id: 'a', text: 'duplicate', completed: true },
        { id: 'bad', text: '', completed: false },
        { id: 'b', text: 'B', completed: true }
      ] })
    });
    assert.deepEqual(loadTasks(storage).tasks, [
      { id: 'a', text: 'A', completed: false },
      { id: 'b', text: 'B', completed: true }
    ]);
  });
  ```

- [ ] **Step 2: Run focused storage tests and verify failure.**

  Run:

  ```bash
  node --test tests/todo-storage.test.js
  ```

  Expected: FAIL until the storage adapter and fake are implemented.

- [ ] **Step 3: Implement the memory fake and storage adapter.**

  Make the fake deterministic and allow tests to configure read/write exceptions. In `storage.js`, catch parse and storage exceptions, validate the version-one envelope, trim/validate text, require non-empty string IDs and boolean completion, and discard repeated IDs after the first valid record. Do not write during load.

- [ ] **Step 4: Verify serialization and failure results.**

  Run:

  ```bash
  node --test tests/todo-storage.test.js
  node --experimental-test-coverage --test tests/todo-storage.test.js
  ```

  Expected: all storage tests pass, saved JSON has `version: 1`, and storage exceptions become inspectable results rather than uncaught errors.

### Task 4: Build semantic markup and safe UI rendering

**OpenSpec link:** `tasks.md` 3.1 and 3.2

**Files:**
- Modify: `index.html`
- Create: `src/todo/ui.js`
- Modify: `styles/app.css`
- Create: `tests/todo-ui.spec.js` (initial rendering cases)

**Interfaces:**
- `renderTasks({ listElement, emptyStateElement }, tasks) -> void`.
- `bindTodoEvents({ form, input, listElement, onAdd, onToggle, onRemove }) -> () => void`.
- Task rows use `data-task-id`, a checkbox, a text element, and a delete button.
- Completed rows expose a semantic state such as `data-completed="true"` and a completed class.

- [ ] **Step 1: Add browser tests for initial controls and row structure.**

  Use Playwright locators by accessible role/name to assert the labelled input, `添加` button, empty state, and each task row's checkbox and `删除` control. Add a case with task text `<img src=x onerror=alert(1)>` and assert the literal text appears while no extra image element is created.

- [ ] **Step 2: Run the browser tests and verify failure.**

  Run:

  ```bash
  npx playwright test tests/todo-ui.spec.js
  ```

  Expected: FAIL because the semantic shell, render function, and application wiring are incomplete.

- [ ] **Step 3: Implement semantic markup and safe rendering.**

  Add a labelled form, input, named add button, list container, empty-state region, and non-blocking status region to `index.html`. In `ui.js`, create elements with DOM APIs, assign task text via `textContent`, set checkbox state, generate an accessible delete name containing the task text, and render empty/non-empty states without user text in `innerHTML`.

- [ ] **Step 4: Add completed styling and narrow-layout rules.**

  Add readable layout, wrapping for long task text, usable controls, and a completed rule that includes `text-decoration: line-through`. Keep the visual state driven by the semantic class/data attribute so later filtering or priority decoration can be layered independently.

- [ ] **Step 5: Run focused UI tests.**

  Run:

  ```bash
  npx playwright test tests/todo-ui.spec.js
  ```

  Expected: initial controls, task-row structure, completed visual hooks, and literal text rendering pass.

### Task 5: Compose state, events, persistence, and reload behavior

**OpenSpec link:** `tasks.md` 3.3 and 3.4

**Files:**
- Modify: `src/main.js`
- Modify: `index.html` only if the final status/list IDs need alignment with `ui.js`
- Modify: `tests/todo-ui.spec.js`

**Interfaces:**
- `main.js` owns `let tasks` and injects the model, storage, and UI dependencies.
- Form submit calls `onAdd(trimmedInput)` once and clears the input after a successful task creation.
- Delegated checkbox action calls `onToggle(taskId)`; delete action calls `onRemove(taskId)`.
- Each mutation replaces the array, renders, then calls `saveTasks`; a failed save updates the status region without undoing memory/UI state.

- [ ] **Step 1: Add failing browser interaction and reload tests.**

  Cover click add, Enter submit, blank submission, complete/uncomplete deletion visual, targeted deletion, state restoration after reload, deleted-task absence after reload, and storage failure status. Example interaction shape:

  ```js
  await page.getByLabel('任务').fill('购买牛奶');
  await page.getByRole('button', { name: '添加' }).click();
  await expect(page.getByRole('listitem')).toHaveCount(1);
  await page.getByRole('checkbox', { name: /购买牛奶/ }).check();
  await page.reload();
  await expect(page.getByRole('listitem')).toContainText('购买牛奶');
  await expect(page.getByRole('checkbox', { name: /购买牛奶/ })).toBeChecked();
  ```

- [ ] **Step 2: Run the interaction suite and verify failure.**

  Run:

  ```bash
  npx playwright test tests/todo-ui.spec.js
  ```

  Expected: FAIL because `main.js` does not yet connect UI callbacks to model and storage operations.

- [ ] **Step 3: Implement initialization and one-owner state flow.**

  On `DOMContentLoaded`/module execution, construct the storage adapter around `window.localStorage`, call `loadTasks`, set the in-memory array, render, and bind callbacks. Each callback must compute a new array by stable ID, replace state, render, and then attempt persistence. Use `event.preventDefault()` for form submission and event delegation for list actions.

- [ ] **Step 4: Add recoverable status handling.**

  Show a short status message when load or save returns a warning. Do not throw the warning through the event handler, do not navigate on submit, and do not restore deleted rows after reload.

- [ ] **Step 5: Run all browser interaction tests.**

  Run:

  ```bash
  npm run test:e2e
  ```

  Expected: all core OpenSpec UI and persistence scenarios pass in an isolated browser context.

### Task 6: Document usage, extension boundaries, and final validation

**OpenSpec link:** `tasks.md` 4.1, 4.2, and 4.3

**Files:**
- Modify: `README.md`
- Modify: `styles/app.css` if responsive test reveals a layout defect
- Modify: `tests/todo-ui.spec.js` if the narrow viewport test needs its final assertions
- Modify: `package.json` only if a documented command differs from the validated command

**Interfaces:**
- README documents the exact commands `npm install`, `npm run start`, `npm run test:unit`, `npm run test:coverage`, `npm run test:e2e`, `npm run build`, and `npm run check`.
- README documents local-only `todo-app.tasks` persistence and explicitly lists future filtering/priority as extension boundaries, not implemented features.

- [ ] **Step 1: Add the narrow viewport browser assertion.**

  Set a viewport such as `{ width: 360, height: 800 }`; add a task with a long but valid label; assert the task text and checkbox/delete controls remain visible and usable without horizontal overflow that prevents interaction.

- [ ] **Step 2: Update README with verified setup and architecture.**

  Include prerequisites (Node.js and Python 3 for the static server), local start command, all test/coverage/build commands, module responsibilities, storage key and version-one envelope, storage failure behavior, and explicit non-goals. Do not claim a command until it has been run successfully.

- [ ] **Step 3: Run the complete validation sequence.**

  Run:

  ```bash
  npm install
  npm run test:unit
  npm run test:coverage
  npm run test:e2e
  npm run build
  npm run check
  (cd docs && openspec validate single-page-todo-app)
  git diff --check
  ```

  Expected: all commands exit successfully; unit/model/storage coverage is at least 90%; the build produces deployable static files; every OpenSpec scenario has test evidence; and OpenSpec reports the change as valid.

- [ ] **Step 4: Review the implementation against the source-of-truth task list.**

  Confirm each item in `docs/openspec/changes/single-page-todo-app/tasks.md` has corresponding code and verification evidence. Update only the OpenSpec task checkboxes during implementation when the repository workflow calls for progress tracking; do not add replacement tasks in this plan.

## Execution Notes

- Start implementation from `base-ref` `bf95910a564bc74ce2ba71df1eab258c29f8b1af`.
- Keep commits small and logically scoped, for example: setup, model, storage, UI, composition, and validation/docs.
- Do not modify `docs/openspec/changes/single-page-todo-app/proposal.md`, `design.md`, or the delta spec while implementing unless behavior must intentionally change; any such behavioral change requires updating OpenSpec first.
- The OpenSpec `tasks.md` file remains the unique task source of truth. This plan is an execution map and must not become a second checklist with different scope.
