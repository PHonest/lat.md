This directory defines the high-level concepts, business logic, and architecture of this project using markdown. It is managed by [lat.md](https://www.npmjs.com/package/lat.md) — a tool that anchors source code to these definitions. Install the `lat` command with `npm i -g lat.md` and run `lat --help`.

**Markdown-first.** This project is built around markdown and its output should reflect that. CLI error messages, diagnostics, and reports use structured, readable formatting — bullet-point lists, indented context, and clear spacing between items — so output is scannable both by humans and by LLM-based agents consuming it.

- **cli.md** — CLI commands, options, and output formats for the `lat` tool
- **dev-process.md** — Development tooling, testing, formatting, and publishing conventions
- **markdown.md** — Markdown extensions (wiki links, frontmatter) used in lat.md files
- **parser.md** — Markdown parsing architecture, section tree construction, and ref extraction
- **tests** — High-level test specifications mapped to code via require-code-mention
- **website.md** — Standalone Next.js marketing site deployed to Vercel
