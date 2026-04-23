# Contributing

## Code Shape

- Keep each source file focused on one responsibility.
- Avoid mixing route handlers, domain services, repositories, and schemas in the same file.
- Export public APIs through each package `src/index.ts` only.
- Prefer explicit DTO and schema modules over hidden inline object contracts.
- Web features live under feature folders. Backend workflows live under domain or workflow folders.

## Quality Gates

- `bun run lint`
- `bun run typecheck`
- `bun run test`
- `bun run test:coverage`
- `bun run check:file-size`

Each package is expected to keep at least 90% unit test coverage. Add or update tests with every behavior change.

## Testing Approach

- Unit tests cover config parsing, policy merging, manifest validation, startup validation, and scope mapping.
- Integration tests cover connector loading paths and runtime-state persistence.
- End-to-end tests are expected to grow around bootstrap, scope selection, learning progress, readiness, and grounded chat.

## Review Checklist

- Public interfaces are documented and exported from the owning package.
- Static config remains read-only at runtime.
- Runtime policy never bypasses hard deny.
- Learning stays read-only.
- Evidence and provenance are preserved when material moves toward `dense-mem`.
