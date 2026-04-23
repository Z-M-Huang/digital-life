# digital-life

`digital-life` is a Bun/TypeScript monorepo for a single-persona system that learns from configured connectors, stores durable memory in `dense-mem`, and exposes operational state through an API and web console.

## Architecture

- Connectors are the integration boundary. Native and MCP-backed connectors expose one shared tool contract and produce one unified AI SDK tool registry at runtime.
- Static integration configuration lives in [`config/digital-life.yaml`](/app/digital-life/config/digital-life.yaml). Credentials, transport, headers, hard safety defaults, and prompt overrides stay file-driven.
- Runtime scope, bootstrap state, effective tool policy, readiness, learning runs, and evidence pointers live in Postgres.
- `dense-mem` is the only durable memory layer. This repo only owns the client boundary and write orchestration.

## Repository Standards

- Keep repository-authored source and test files under 500 lines.
- Generated files, migrations, snapshots, and lockfiles are excluded from the file-size rule.
- Keep one responsibility per file. Do not mix route, service, and repository logic in the same module.
- Use package exports as the only cross-package import surface.
- Backend code is organized by domain or workflow. Web code is organized by feature folders.
- Routes stay thin. DTO and schema files stay explicit. Orchestration logic stays isolated from transport code.

## Workspace Layout

- `packages/core`: config loading, policy rules, Postgres schema, dense-mem boundary
- `packages/connectors`: connector contracts, built-in loaders, extension loading, MCP bridge, tool registry
- `packages/agents`: learner agent scaffolds
- `packages/orchestrator`: runtime composition, services, repositories
- `packages/api`: Hono API and SSE surfaces
- `packages/web`: Vite/React operations console

## Commands

- `bun install`
- `bun run lint`
- `bun run typecheck`
- `bun run test`
- `bun run test:coverage`
- `bun run check:file-size`

## Local Stack

- [`docker-compose.example.yml`](/app/digital-life/docker-compose.example.yml) is the committed full-stack reference. It starts shared Postgres, shared Redis, Neo4j, `dense-mem` built from the sibling [`../dense-mem`](../dense-mem) checkout, the `digital-life` API, and a built web console.
- Copy the example to `docker-compose.yml` for local work, then customize as needed. That file is intentionally ignored by Git.
- [`docker-compose.yml`](/app/digital-life/docker-compose.yml) is the local development version of that stack. It runs the same services but keeps the `digital-life` API and web console in watch mode with bind mounts.
- Both Compose files now declare healthchecks for `postgres`, `redis`, `neo4j`, `dense-mem`, `digital-life`, and the web console.
- The `digital-life` container runs `bun run db:migrate` from its entrypoint before the API process starts, so a fresh stack initializes runtime tables automatically.
- `dense-mem` requires OpenAI-compatible embedding settings at startup. Copy [`.env.example`](/app/digital-life/.env.example) to `.env` and set `OPENAI_API_KEY` before running either Compose stack.
- [`Dockerfile`](/app/digital-life/Dockerfile) exposes three build targets:
  - `workspace` for dev/watch containers
  - `api` for the production-style API container
  - `web` for the production-style static web container

## Config Wiring

- Static config lives in [`config/digital-life.yaml`](/app/digital-life/config/digital-life.yaml).
- The API process loads that file from `DIGITAL_LIFE_CONFIG_PATH` when set, otherwise it falls back to the repository-relative default: [server.ts](/app/digital-life/packages/api/src/server.ts).
- Secrets and runtime endpoints are provided through environment variables from `.env` or Compose `environment`, then interpolated into the YAML at load time: [load-config.ts](/app/digital-life/packages/core/src/config/load-config.ts).
- Prompt override files are real repository assets under [`config/prompts/system.md`](/app/digital-life/config/prompts/system.md) and [`config/prompts/bootstrap.md`](/app/digital-life/config/prompts/bootstrap.md). Config loading now fails fast if any prompt override path is invalid.
- Extension connector module paths, prompt override paths, and MCP process working directories are resolved relative to the YAML file location, so custom connectors can be referenced with config-relative paths and loaded at startup.
- The app image copies the repository workspace into `/app`, and both Compose files set `DIGITAL_LIFE_CONFIG_PATH=/app/config/digital-life.yaml`.
- The dev web container proxies `/api` to the API service through `VITE_API_PROXY_TARGET`: [vite.config.ts](/app/digital-life/packages/web/vite.config.ts).
- The production-style web container serves built assets and proxies `/api` through [server.ts](/app/digital-life/packages/web/src/server.ts).

## Contribution Guide

Contributor expectations and architectural guardrails are documented in [`docs/contributing.md`](/app/digital-life/docs/contributing.md).
