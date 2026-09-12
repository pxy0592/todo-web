# Repository Guidelines

## Project Structure & Module Organization

This repository is currently a spec-driven scaffold. The root contains the project overview in `README.md`. OpenSpec configuration and workflow support live under `docs/openspec/`; specifications belong in `docs/openspec/specs/`, and changes in `docs/openspec/changes/`. No application source, test suite, or asset directory exists yet; add them only when specified.

## Spec-Driven Development

Specifications are the source of truth. Read the relevant `docs/openspec/` files and confirm acceptance criteria before implementing. Keep proposals, designs, and task lists there; implementation code belongs elsewhere. If behavior intentionally changes, update the specification, code, and tests together.

Typical workflow commands (run from `docs/openspec/`) are:

```bash
openspec list --json
openspec status --json
openspec new change "short-change-name"
```

## Build, Test, and Development Commands

No build, development-server, or test command is configured because no application code exists. When code is added, document canonical commands here and in `README.md`; run formatting, linting, tests, and the build before submitting.

## Coding Style & Naming Conventions

Follow the language/framework conventions introduced by each feature. Prefer small modules, explicit names, and existing patterns. Use lowercase kebab-case for OpenSpec changes (for example, `add-task-filter`) and behavior-focused test names. Add formatter and linter configuration with the first implementation that needs them.

## Testing Guidelines

Each acceptance criterion needs at least one automated test, and new units should target at least 90% coverage. Keep tests near relevant source when supported; use names such as `should reject an empty task title`. Run the complete test and coverage commands before submission.

## Commit & Pull Request Guidelines

History is minimal; the latest commit uses `docs: update`. Use concise, imperative subjects with a meaningful scope (for example, `feat: add task model` or `docs: clarify setup`). PRs should explain the change, link an issue or OpenSpec change, list validation, and include UI screenshots when relevant. Keep unrelated refactors out.

## Security & Configuration

Never commit secrets, tokens, or machine-specific credentials. Document required configuration with safe example values and keep local overrides untracked. Review generated documentation and configuration changes for accidental sensitive data before committing.
