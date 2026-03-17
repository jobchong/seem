# seem

`seem` is a harness-independent visual verification tool for agent workflows. The goal is to let a model verify human-visible changes by rendering a target, capturing pixels and metadata, and running review checks before claiming success.

The repository is currently at Phase 0: the monorepo scaffold, TypeScript tooling, hello-world CLI, and MCP server are in place. The architecture and implementation plan live in [`docs/architecture.md`](./docs/architecture.md) and [`docs/implementation.md`](./docs/implementation.md).

## Current Workspace

- `packages/core`: shared schemas and core utilities
- `packages/cli`: command-line entrypoint
- `packages/mcp`: MCP server entrypoint
- `packages/adapters-browser`: placeholder browser adapter package
- `packages/shared-test-utils`: shared test helpers
- `packages/fixtures`: sample fixture directories for future integration work

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

The current implementation is intentionally minimal. Phase 1 will add the first real product primitives:

- schema inventory beyond the hello-world bootstrap
- `seem.yaml` parsing and validation
- run artifact storage under `.seem/runs`
- initial service boundaries for assessment and target resolution

## Contributing

See [`AGENTS.md`](./AGENTS.md) for repository-specific contributor guidance. Use small, scoped commits and keep the design docs in sync when the implementation changes direction.
