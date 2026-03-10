# Agents

## Source of Truth

The `lat.md/` directory contains the authoritative description of this codebase. Before making changes, read the relevant `lat.md/*.md` files to understand the concepts, architecture, and conventions.

Current files:
- `lat.md/cli.md` — CLI commands (`locate`, `refs`, `check`) and their behavior
- `lat.md/markdown.md` — syntax extensions: wiki links, frontmatter
- `lat.md/parser.md` — internal parsing: remark pipeline, wiki link AST nodes, section extraction
- `lat.md/dev-process.md` — tooling, testing, formatting, publishing
- `lat.md/tests.md` — high-level test descriptions; actual tests reference these via `// @lat: [[...]]` comments
- `lat.md/website.md` — the lat.md website (separate Next.js subproject)

## Maintaining `lat.md`

When you add new functionality, commands, or change how the project is structured (e.g. test strategy, build pipeline, directory layout):
1. Update the relevant `lat.md/*.md` file, or create a new one if no existing file fits
2. Cross-link between files using Obsidian wiki link syntax: `[[Page#Section]]`
3. Keep descriptions high-level — what things do and why, not implementation minutiae
4. **Always run `lat check` after updating `lat.md/` files** — all wiki links must resolve to existing sections. Do not leave broken links.

## Using `lat`

Run `lat locate "<section>"` to find a section by id. Run `lat refs "<section>"` to find what references it. Use these to understand how concepts connect before making changes.

When processing user prompts that contain `[[refs]]`, pipe them through `lat prompt` first to resolve references to `lat.md` section locations.

## Code Conventions

See `lat.md/dev-process.md` for the full list. Key points:
- TypeScript ESM, strict mode
- pnpm only
- `pnpm test` must pass (includes typecheck)
- Prettier: no semicolons, single quotes, trailing commas

## Verification

After making changes, always run:
1. `pnpm test` — all tests must pass (includes typecheck)
2. `pnpm build && node dist/src/cli/index.js check` — validates all `@lat:` code refs resolve and all wiki links in `lat.md/` are valid

Both must pass before considering work complete.
