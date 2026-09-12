---
change: single-page-todo-app
role: technical-design
canonical_spec: openspec
---

# Single-Page Todo App Technical Design

## 1. Design Scope and Source of Truth

This document defines the implementation approach for change `single-page-todo-app`. The OpenSpec proposal and delta spec remain the source of truth for user-visible behavior; this document does not introduce or duplicate requirements. The existing delta spec already includes scenarios for creation, blank input, row rendering, completion toggling, deletion, restoration, deletion persistence, invalid stored data, and extensibility, so no delta-spec amendment is required.

The implementation is intentionally limited to a browser-only single-page application. It does not add accounts, synchronization, a server API, a database, filtering, priority, editing, sorting, or bulk actions.

## 2. Confirmed Technical Decisions

### 2.1 Runtime and tooling

Use native HTML, CSS, and JavaScript with ES modules. Do not introduce a UI framework or a build framework for this initial slice. Serve the static page through a small documented local server. Use Node's built-in `node:test` and assertions for model and storage unit tests. Use Playwright only for browser-level behavior that requires real DOM, browser storage, or reload semantics.

This keeps the runtime dependency-free while preserving a path to replace the presentation layer later without changing the task model or storage contract.

### 2.2 Module boundaries

Use the following structure:

```text
index.html
src/
  main.js
  todo/
    model.js
    storage.js
    ui.js
styles/
  app.css
tests/
  todo-model.test.js
  todo-storage.test.js
  todo-ui.test.js
```

The exact test filename layout may follow the selected runner, but responsibilities must remain separated:

- `model.js` contains pure task construction and list operations. It has no DOM or browser-storage dependency.
- `storage.js` adapts a supplied storage object to the versioned persistence format. It does not render UI or choose notification copy.
- `ui.js` renders task rows and binds semantic form/list events. It receives callbacks for state changes instead of owning business rules or persistence.
- `main.js` composes dependencies, owns the current in-memory task list, coordinates mutations, renders, persists, and exposes non-blocking status messages.

### 2.3 Pure model API

The model should expose small, deterministic operations equivalent to:

```js
createTask(text, idFactory)
addTask(tasks, text, idFactory)
toggleTask(tasks, taskId)
removeTask(tasks, taskId)
```

The model trims input, rejects empty or whitespace-only text, defaults new tasks to `completed: false`, and creates a stable unique `id`. List operations return new arrays and do not mutate their input. Unknown IDs are no-ops that return an equivalent result. ID creation is injectable; production may use `crypto.randomUUID()`, while tests use a deterministic factory.

These operations are the extension seam for future task attributes. Adding a priority field should extend task construction and validation without forcing UI event handlers to operate on array indexes.

## 3. Persistence Contract

### 3.1 Storage interface and format

`storage.js` should accept a storage dependency with `getItem` and `setItem`, allowing production to pass `window.localStorage` and tests to pass an in-memory fake. Use one fixed application key, for example:

```text
todo-app.tasks
```

Persist a versioned envelope:

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

Expose behavior equivalent to:

```js
loadTasks(storage)
saveTasks(storage, tasks)
```

The storage adapter owns serialization and validation, but not task mutation rules.

### 3.2 Read path

`loadTasks()` follows this fail-safe sequence:

1. Missing storage value returns `[]`.
2. JSON parse failure returns `[]`.
3. An invalid envelope, unsupported version, or non-array `tasks` value returns `[]`.
4. Invalid task records are discarded individually; valid records in the same array remain available.
5. Each retained record must have a non-empty string ID, non-empty string text, and boolean `completed`.
6. Storage read exceptions are caught and surfaced as a recoverable status to the composition layer; initialization continues with `[]`.

The loader should also reject duplicate IDs during normalization, because duplicate identifiers would violate the DOM and mutation lookup contract. A duplicate is invalid data and should be discarded rather than allowing two rows to share an action target.

### 3.3 Write path and error behavior

After a successful in-memory mutation, `main.js` renders the new state and calls `saveTasks()`. A write exception, including quota or unavailable-storage errors, must not crash the page or roll back the current in-memory state. The composition layer displays a short non-blocking warning while allowing subsequent operations in the current session.

Initialization does not rewrite storage merely because it loaded data. Migration is reserved for a future versioned change. If a future version is introduced, the reader must branch by `version`, migrate known old data, and write the new envelope only after successful migration.

## 4. UI and State Flow

### 4.1 Markup and accessibility

Use a semantic form containing a labelled text input and an explicitly named add button. Use a list container for task rows. Each row contains:

- a checkbox associated with the task text or an equivalent accessible label;
- a text element populated with `textContent`;
- a delete button with an accessible name that identifies the task.

The form listens to `submit`, calls `preventDefault()`, and therefore supports both button activation and Enter submission without duplicate handlers. The list container uses event delegation. Each row carries `data-task-id`; actions resolve the ID from the closest row, never from its visual position.

An empty list receives a clear empty-state message. Completed state is represented by both a checkbox state and a semantic class or data attribute, with a deletion visual such as `text-decoration: line-through`. The UI must not concatenate user task text into `innerHTML`.

### 4.2 Composition flow

`main.js` performs this initialization:

1. Construct the storage adapter around `window.localStorage`.
2. Load and normalize persisted tasks, recording any recoverable warning.
3. Set the in-memory task list.
4. Render the initial list and empty state.
5. Bind form and delegated list events.

Each user mutation follows one path:

```text
DOM event
  -> main.js extracts text or task ID
  -> model operation returns a new task array
  -> main.js replaces in-memory state
  -> ui.js renders the current array
  -> storage.js attempts persistence
  -> failure becomes a non-blocking status message
```

The state update is synchronous and single-owner. This prevents rapid interactions from using stale row indexes. Rendering happens from the complete current array, which also makes future filtering a derived view rather than a change to mutation identity.

## 5. Testing Strategy

### 5.1 Model unit tests

Use deterministic IDs and assert both returned values and immutability. Cover non-empty and trimmed input, blank-input rejection, default incomplete state, unique IDs, completion transitions, unknown-ID no-ops, deletion by ID, preservation of unrelated tasks, and non-mutation of input arrays.

### 5.2 Storage unit tests

Use an in-memory storage fake. Cover missing values, valid version-one restoration, malformed JSON, invalid envelopes, unsupported versions, non-array task collections, individual invalid-record filtering, duplicate-ID handling, mixed valid/invalid data, correct versioned writes, and read/write exceptions. Tests should assert that storage failures return a controllable result or status rather than an uncaught initialization error.

### 5.3 Browser integration tests

Use a real browser context with isolated storage. Cover initial controls and empty state, click and Enter submission, blank submission, row controls, complete/uncomplete styling, targeted deletion, reload restoration of text and completion state, deletion surviving reload, literal rendering of HTML-like input, and usability at a narrow viewport.

The test matrix must map every scenario in `specs/todo-management/spec.md` to at least one automated test. Keep unit coverage for implemented model and storage code at or above 90%; browser tests complement rather than replace unit coverage.

Recommended validation order:

1. formatter and static checks;
2. unit tests with coverage;
3. browser integration tests;
4. production/static build check;
5. `openspec validate single-page-todo-app`.

## 6. Technical Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| `localStorage` is unavailable or quota-limited | Catch all adapter read/write exceptions, keep current in-memory state usable, and show a non-blocking warning. |
| User text is interpreted as markup | Create text nodes or assign `textContent`; never interpolate task text into HTML. |
| Duplicate or malformed restored IDs cause wrong actions | Validate ID type and uniqueness before rendering; use `data-task-id` lookup rather than indexes. |
| Rapid actions target stale rows | Keep one current array in `main.js`, identify rows by stable ID, and rerender after each mutation. |
| Native tooling becomes difficult to extend | Keep model and storage interfaces framework-neutral and document all canonical commands in `README.md`. |
| Very long text harms layout | Do not invent a product length limit; allow wrapping/overflow handling in CSS without truncating stored text. |

## 7. Implementation Sequence and Completion Gates

Implementation should proceed in the order already defined by `tasks.md`:

1. establish the static page, module layout, scripts, and test runner;
2. implement and unit-test model operations;
3. implement and unit-test versioned storage;
4. build semantic markup and safe rendering;
5. connect delegated events, persistence, and reload behavior;
6. add responsive styles and README instructions;
7. run the full validation sequence and confirm each OpenSpec scenario has test evidence.

No implementation task is complete based only on source inspection. Each task requires its stated command or observable behavior, and the final acceptance requires passing tests, coverage, build/static checks, and OpenSpec validation.
