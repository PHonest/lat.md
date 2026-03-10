---
lat:
  require-code-mention: true
---
# Tests

High-level test descriptions. Actual test code lives in `tests/`.

## Section Parsing

### Builds a section tree from nested headings

Parse a markdown file with nested headings and verify the resulting tree has correct ids, depths, parent-child relationships, and file stems.

### Populates position and body fields

Verify that `startLine`, `endLine`, and `body` are correctly extracted from heading positions and first-paragraph text.

### Renders inline code in body

Verify that inline code (backtick-wrapped) in a paragraph is preserved in the section `body` field.

### Renders wiki links in body

Verify that wiki links in a paragraph are rendered as `[[target]]` in the section `body` field.

## Ref Extraction

### Extracts wiki link references

Parse a file containing [[parser#Wiki Links]] and verify `extractRefs` returns correct targets, enclosing section ids, file stems, and line numbers.

### Returns empty for files without links

Verify `extractRefs` returns an empty array when a file has no wiki links.

## Section Preview Formatting

### Formats section with body

Verify [[cli#Section Preview]] output includes section id, file path with line range, and indented body text.

### Formats section without body

Verify [[cli#Section Preview]] omits the body lines when a section has no paragraph content.

## Check MD

### Detects broken links

Given a file with a wiki link pointing to a nonexistent section, [[cli#check#md]] should report it as a broken link.

### Passes with valid links

Given files where all wiki links resolve to existing sections, [[cli#check#md]] should report no errors.

## Check Code Refs

### Detects dangling code ref

Given a source file with `@lat: [[Nonexistent]]`, [[cli#check#code-refs]] should report it as pointing to a nonexistent section.

### Detects missing code mention for required file

Given a `lat.md` file with [[markdown#Frontmatter#require-code-mention]] and a leaf section not referenced by any `@lat:` comment in the codebase, [[cli#check#code-refs]] should report the uncovered section.

## Locate

### Finds sections by exact id

Given a full section path query (case-insensitive), `findSections` returns the matching section with correct metadata.

### Matches subsection by trailing segment

Given a query matching only a trailing segment (e.g. `Running Tests`), `findSections` returns sections whose id ends with that segment.

### Fuzzy matches with typos

Given a query with a typo (e.g. `Runing Tests`), `findSections` returns the closest match via edit distance.

## Refs End-to-End

### Finds referring sections via wiki links

Load multiple files, extract refs, and verify that sections containing wiki links targeting a given section are correctly identified.

## Search

Tests in `tests/search.test.ts`.

### Provider Detection

Unit tests (always run). Verify `detectProvider` correctly identifies OpenAI (`sk-`), Vercel (`vck_`), rejects Anthropic (`sk-ant-`) with a helpful message, and rejects unknown prefixes.

### RAG Replay Tests

Functional tests that exercise the full pipeline — indexing, hashing, vector insert, KNN search — using a replay server (`tests/rag-replay-server.ts`) instead of a real embedding API. Test fixture lives in `tests/cases/rag/lat.md/` with pre-recorded vectors in `tests/cases/rag/replay-data/`.

The replay server has two modes:
- **Replay** (default `pnpm test`): serves cached vectors from binary replay data. Matches requests by SHA-256 of input text.
- **Capture** (`pnpm cook-test-rag`): proxies to real API via `LAT_LLM_KEY`, records all text→vector mappings, flushes binary data to `replay-data/` on teardown. Re-run this after changing how sections are chunked or which texts are embedded.

The test sets `LAT_LLM_KEY` to `REPLAY_LAT_LLM_KEY::<server-url>`, which `detectProvider` routes to the local replay server. This way the entire codebase runs unmodified — same `fetch()` calls, same provider logic.

#### Indexes all sections

Index the RAG fixture (9 sections across 2 files), verify counts.

#### Finds auth section for login query

Search for "how do we handle user login and security?" and verify the Authentication section ranks first.

#### Finds performance section for latency query

Search for "what tools do we use to measure response times?" and verify the Performance Tests section ranks first.

#### Incremental index skips unchanged sections

Re-index unchanged content, verify all sections reported as unchanged with zero re-embedding.

#### Detects deleted sections when file is removed

Remove `testing.md`, re-index, verify 4 sections removed and 5 architecture sections remain.
