# CLI

The `lat` command line tool. Entry point: `src/cli/index.ts`.

## locate

Find sections by query. Results are returned in priority order:

1. **Exact match** — full section path matches (case-insensitive). If the query contains `#` (a full path), only exact matches are returned.
2. **Subsection match** — the query matches a trailing segment of a section id. e.g. `Frontmatter` matches `markdown#Frontmatter`.
3. **Fuzzy match** — sections whose id or trailing segments are within edit distance (Levenshtein, max 40% of string length). e.g. `Frontmattar` matches `markdown#Frontmatter`.

Outputs a [[cli#Section Preview]] for each match.

Usage: `lat locate <query>`

Implementation: `src/cli/locate.ts`, matching logic in `findSections()` in `src/lattice.ts`

## refs

Find sections that reference a given section via [[parser#Wiki Links]]. Outputs a [[cli#Section Preview]] for each referring section.

Usage: `lat refs <query> [--scope=md|code|md+code]`

### Scope

- `md` (default) — search `.lat` markdown files for wiki links targeting the query
- `code` — scan source files for `@lat: [[...]]` comments matching the query
- `md+code` — both

Implementation: `src/cli/refs.ts`

## check

Validation command group. Runs all checks when invoked without a subcommand.

Usage: `lat check [md|code-refs]`

Implementation: `src/cli/check.ts`

### md

Validate that all [[parser#Wiki Links]] in `.lat` markdown files point to existing sections.

### code-refs

Two validations:
1. Every `// @lat: [[...]]` comment in source code must point to a real section in `.lat/`
2. For files with [[markdown#Frontmatter#require-code-mention]], every leaf section must be referenced by at least one `// @lat:` comment in the codebase

## prompt

Expand `[[refs]]` in a prompt text to resolved `.lat` section paths with location context. Designed for coding agents to pipe user prompts through before processing.

Usage: `lat prompt <text>` or `echo "text" | lat prompt`

For each `[[ref]]` in the input:
1. **Exact match** — resolves directly
2. **Single fuzzy/subsection match** — resolves automatically
3. **Multiple matches** — errors out listing candidates, tells the agent to ask the user to clarify
4. **No match** — errors out, tells the agent to ask the user to correct the reference

Output replaces `[[ref]]` with `[[resolved-id]]` inline and appends a `<lat-context>` block with section locations and body text.

Implementation: `src/cli/prompt.ts`

## Section Preview

Shared output format used by [[cli#locate]] and [[cli#refs]]. Shows the section id, file path with line range, and the first paragraph of body text.

Implementation: `src/format.ts`
