## 1. Project Setup

- [ ] 1.1 Establish the minimal static web app structure (`index.html`, `src/`, `styles/` or equivalent) and add documented local start/test scripts; verify the page can be served locally.
- [ ] 1.2 Add the chosen lightweight test setup without introducing a UI framework; verify the test runner executes a sample project test.

## 2. Task Model and Persistence

- [ ] 2.1 Implement the task model and pure operations for creation, completion toggling, and ID-based deletion; verify unit tests cover non-empty input, blank input rejection, status transitions, unique IDs, and preserving other tasks.
- [ ] 2.2 Implement versioned `localStorage` serialization, validation, loading, and saving; verify tests cover initial empty state, valid restoration, invalid JSON/shape recovery, and persistence after each mutation.

## 3. Single-Page UI

- [ ] 3.1 Build semantic markup for the task form and task-list container with accessible labels and button names; verify the rendered page exposes the input, “添加” button, task rows, checkboxes, and “删除” controls.
- [ ] 3.2 Implement UI rendering with safe text insertion and completed-task styling; verify completed text has a deletion visual and user task text is not interpreted as HTML.
- [ ] 3.3 Connect form submission, Enter-key submission, checkbox changes, and delete actions through event delegation; verify browser integration tests cover add, blank submission, complete/uncomplete, and delete behavior.
- [ ] 3.4 Load persisted tasks during page initialization and save state after every mutation; verify an end-to-end refresh restores text and completion state and does not restore deleted tasks.

## 4. Validation and Documentation

- [ ] 4.1 Add responsive, readable styling for the single-page layout and distinct completed state; verify the page remains usable at narrow viewport widths.
- [ ] 4.2 Update `README.md` with prerequisites, local development, test, build (if applicable), storage behavior, and extension boundaries; verify every documented command works from a clean checkout.
- [ ] 4.3 Run the full formatter/linter, unit and integration tests, coverage report, and production build; verify all acceptance-criterion scenarios pass and unit coverage reaches at least 90%.
