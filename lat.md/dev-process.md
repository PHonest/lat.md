# Dev Process

## Tooling

TypeScript ESM project (`"type": "module"`). Strict types enforced — `tsc --noEmit` runs as a [[dev-process#Testing#Typecheck Test]].

## Package Manager

pnpm is the only supported package manager. Never use npm or yarn.

## Testing

Vitest is the test runner. Tests live in the top-level `tests/` directory.

### Test Structure

See [[tests#Conventions]] for testing principles. Tests use fixture directories under `tests/cases/`, each a self-contained mini-project with its own `lat.md/` and source files. The test harness in `tests/cases.test.ts` provides helpers (`caseDir()`, `latDir()`) to point `lat` functions at a given fixture.

### Running Tests

- `pnpm test` — run all tests once
- `pnpm test:watch` — run in watch mode

### Typecheck Test

Every test run includes a full `tsc --noEmit` pass over the entire codebase. If it doesn't typecheck, it doesn't pass.

## File Walking

All directory walking goes through `walkEntries()` in `src/walk.ts` — the single entry point that wraps the `ignore-walk` npm package with `.gitignore` support and filters out `.git/` and dotfiles. This ensures `.gitignore` rules are consistently honored everywhere.

`walkFiles()` in `src/code-refs.ts` calls `walkEntries()` then additionally skips `.md` files, `lat.md/`, `.claude/`, and sub-projects (directories containing their own `lat.md/`).

`checkIndex()` in `src/cli/check.ts` calls `walkEntries()` on the `lat.md/` directory itself to discover visible entries for index validation.

## Formatting

Prettier with no semicolons, single quotes, trailing commas. Run `pnpm format` before committing.

## Publishing

Published to npm as `lat.md`. The `bin` entry exposes the `lat` command. Only `dist/src` is included in the package — tests and the [[website]] are excluded.
