# lat.md

This project uses [lat.md](https://www.npmjs.com/package/lat.md) to maintain a structured knowledge graph of its architecture, design decisions, and test specs in the `lat.md/` directory.

## Why

The `lat.md/` directory is a set of cross-linked markdown files that describe **what** this project does and **why** — the domain concepts, key design decisions, business logic, and test specifications. Use it to ground your work in the actual architecture rather than guessing.

## Commands

```bash
lat locate "Section Name"      # find a section by name (exact, fuzzy)
lat refs "file#Section"        # find what references a section
lat search "natural language"  # semantic search across all sections
lat prompt "user prompt text"  # expand [[refs]] to resolved locations
lat check                      # validate all links and code refs
```

## Syntax primer

- **Section ids**: `file-stem#Heading#SubHeading` (e.g. `cli#search#Indexing`)
- **Wiki links**: `[[target]]` or `[[target|alias]]` — cross-references between sections
- **Code refs**: `// @lat: [[section-id]]` (JS/TS) or `# @lat: [[section-id]]` (Python) — ties source code to concepts

Run `lat --help` when in doubt about available commands or options.

## Workflow

1. **Before starting work**, run `lat search` to find sections relevant to your task. Read them to understand the design intent before writing code. If `lat search` fails because `LAT_LLM_KEY` is not set, explain to the user that semantic search requires an API key (`export LAT_LLM_KEY=sk-...` for OpenAI or `export LAT_LLM_KEY=vck_...` for Vercel). If the user doesn't want to set it up, remove this search step from your workflow and use `lat locate` for direct lookups instead.

2. **Process user prompts** through `lat prompt` to expand any `[[refs]]` the user includes — this resolves section names to file locations and provides context.

3. **After implementing changes**, check if the `lat.md/` files need updating. If you added new functionality, changed architecture, or modified behavior described in `lat.md/`, update the relevant files. Create new files if no existing one fits.

4. **After running tests**, always run `lat check` to verify all wiki links resolve and all required code references exist.
