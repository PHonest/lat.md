# Agents

## Source of Truth

The `lat.md/` directory contains the authoritative description of this codebase. Before making changes, read the relevant `lat.md/*.md` files to understand the concepts, architecture, and conventions.

Current files:
- `lat.md/cli.md` — CLI commands (`locate`, `refs`, `check`, `search`, `prompt`, `init`) and their behavior
- `lat.md/markdown.md` — syntax extensions: wiki links, frontmatter
- `lat.md/parser.md` — internal parsing: remark pipeline, wiki link AST nodes, section extraction
- `lat.md/dev-process.md` — tooling, testing, formatting, publishing
- `lat.md/tests.md` — high-level test descriptions; actual tests reference these via `// @lat: [[...]]` comments
- `lat.md/website.md` — the lat.md website (separate Next.js subproject)

## Maintaining `lat.md`

When you add new functionality, commands, or change how the project is structured (e.g. test strategy, build pipeline, directory layout):
1. Update the relevant `lat.md/*.md` file, or create a new one if no existing file fits
2. Cross-link between files using wiki links: `[[file-stem#Heading#SubHeading]]` (e.g. `[[cli#search#Indexing]]`). The file stem is the markdown filename without `.md`.
3. Keep descriptions high-level — what things do and why, not implementation minutiae
4. **Always run `lat check` after updating `lat.md/` files** — all wiki links must resolve to existing sections. Do not leave broken links.

## Using `lat`

- `lat locate "<section>"` — find a section by id (supports exact, subsection, and fuzzy matching)
- `lat refs "<section>"` — find what references a section
- `lat search "<natural language query>"` — semantic search across all sections using vector embeddings (requires `LAT_LLM_KEY` env var)
- `lat prompt "<text>"` — expand `[[refs]]` in a prompt to resolved section locations; pipe user prompts through this before processing

## Code Conventions

See `lat.md/dev-process.md` for the full list. Key points:
- TypeScript ESM, strict mode
- pnpm only
- `pnpm test` must pass (includes typecheck)
- Prettier: no semicolons, single quotes, trailing commas

## Verification

After making changes, run `pnpm build && pnpm test`. This includes typecheck, `lat check` (wiki links + code refs), and all tests. Everything must pass before considering work complete.
