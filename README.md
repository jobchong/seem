# seem

`seem` is a harness-independent visual verification tool for agent workflows. The goal is to let a model verify human-visible changes by rendering a target, capturing pixels and metadata, and running review checks before claiming success.

The repository now has the Phase 2 and Phase 3 foundations in place: shared schemas, `seem.yaml` parsing, file-backed run storage, rule-based change assessment and target resolution, and a Playwright-backed browser adapter MVP with fixture-backed integration coverage. The CLI and MCP entrypoints are still the Phase 0 hello-world smoke paths while later phases fill in end-to-end review execution and gating. The architecture and implementation plan live in [`docs/architecture.md`](./docs/architecture.md) and [`docs/implementation.md`](./docs/implementation.md).

## Current Workspace

- `packages/core`: shared schemas and core utilities
- `packages/cli`: command-line entrypoint
- `packages/mcp`: MCP server entrypoint
- `packages/adapters-browser`: Playwright-backed browser adapter package
- `packages/shared-test-utils`: shared test helpers
- `packages/fixtures`: sample browser and render fixtures for integration work

## Getting Started

Requirements:

- Node.js 22+
- `pnpm` 10.32.1+

Install dependencies:

```bash
pnpm install
```

## Development Commands

```bash
pnpm test
pnpm build
pnpm lint
pnpm format:check
pnpm cli:hello
pnpm mcp:start
```

Notes:

- `pnpm cli:hello` runs the Phase 0 CLI smoke path and prints the hello-world payload.
- `pnpm mcp:start` starts the MCP server over stdio.

## Project Status

The current implementation includes:

- schema inventory beyond the hello-world bootstrap
- `seem.yaml` parsing and validation
- run artifact storage under `.seem/runs`
- artifact naming and run event logging
- rule-based assessment and ranked target resolution
- browser session management, viewport capture, DOM geometry extraction, and simple journey execution

The next major steps are Phase 4 normalization, deterministic review checks, and end-to-end CLI/MCP execution on top of these contracts.

## Contributing

See [`AGENTS.md`](./AGENTS.md) for repository-specific contributor guidance. Use small, scoped commits and keep the design docs in sync when the implementation changes direction.
