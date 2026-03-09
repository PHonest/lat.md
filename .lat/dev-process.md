# Dev Process

## Tooling

TypeScript ESM project (`"type": "module"`). Strict types enforced — `tsc --noEmit` runs as a [[dev-process#Testing#Typecheck Test]].

## Package Manager

pnpm is the only supported package manager. Never use npm or yarn.

## Testing

Vitest is the test runner. Tests live in the top-level `tests/` directory.

### Test Structure

Tests use a fixture-based approach. `tests/cases/` contains directories that each represent an isolated test scenario. Each case directory has its own `.lat/` and source files forming a self-contained mini-project. The test harness in `tests/cases.test.ts` provides helpers (`caseDir()`, `latDir()`) to point `lat` functions at a given fixture. This avoids creating temp dirs or files at runtime — every scenario is a static fixture on disk.

`tests/lattice.test.ts` holds a small number of pure unit tests that use inline strings rather than fixtures (e.g. verifying `parseSections` handles edge cases).

### Running Tests

- `pnpm test` — run all tests once
- `pnpm test:watch` — run in watch mode

### Typecheck Test

Every test run includes a full `tsc --noEmit` pass over the entire codebase. If it doesn't typecheck, it doesn't pass.

## Formatting

Prettier with no semicolons, single quotes, trailing commas. Run `pnpm format` before committing.

## Publishing

Published to npm as `lat.md`. The `bin` entry exposes the `lat` command. Only `dist/src` is included in the package — tests and the [[website]] are excluded.
