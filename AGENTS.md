# Repository Guidelines

## Project Structure & Module Organization

This repository uses a small `pnpm` monorepo. [`docs/architecture.md`](/Users/jobchong/git/seem/docs/architecture.md) defines the system design, and [`docs/implementation.md`](/Users/jobchong/git/seem/docs/implementation.md) defines the delivery plan and target stack. Runtime code lives under `packages/`: `core` for shared contracts and services, `cli` for the command-line entrypoint, `mcp` for the MCP server, `adapters-browser` for browser-facing adapter work, `shared-test-utils` for reusable test helpers, and `fixtures/` for sample targets.

## Build, Test, and Development Commands

Use Node.js 22+ and `pnpm`.

- `pnpm install`: install root and workspace dependencies.
- `pnpm test`: run the baseline Vitest suite.
- `pnpm build`: build all workspace packages with `tsup`.
- `pnpm cli:hello`: run the hello-world CLI command.
- `pnpm mcp:start`: start the MCP server on stdio.

If you introduce new scripts, keep names consistent across packages and document them in [`docs/implementation.md`](/Users/jobchong/git/seem/docs/implementation.md).

## Coding Style & Naming Conventions

Use TypeScript for new runtime code. Prefer 2-space indentation, `camelCase` for variables and functions, `PascalCase` for types and classes, and `kebab-case` for package and file names. Keep schemas first-class: define `zod` schemas close to shared types in `packages/core`, and keep adapters behind narrow interfaces. Run `pnpm lint` and `pnpm format` before opening a PR when you touch source files.

## Testing Guidelines

Use `vitest` for unit and service tests today, and add `@playwright/test` when browser integration work begins. Name test files `*.test.ts` and keep them under a package-local `test/` directory unless colocation is materially clearer. For visual workflows, prefer golden JSON or artifact assertions over broad pixel goldens, and store run artifacts under `.seem/runs/`.

## Commit & Pull Request Guidelines

`main` currently has no commit history, so no repository-specific commit convention exists yet. Start with short imperative subjects, ideally scoped, for example `docs: refine artifact storage layout` or `core: add ChangeAssessment schema`. Pull requests should explain intent, list affected packages or docs, link related issues, and include screenshots or captured artifacts when behavior is human-visible. Update [`docs/architecture.md`](/Users/jobchong/git/seem/docs/architecture.md) or [`docs/implementation.md`](/Users/jobchong/git/seem/docs/implementation.md) whenever a change affects the documented design.
