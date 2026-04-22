---
lat:
  require-code-mention: true
---
# Search

Tests in `tests/search.test.ts`.

## Provider Detection

Unit tests (always run). Verify `detectProvider` correctly identifies OpenAI (`sk-`), Vercel (`vck_`), rejects Anthropic (`sk-ant-`) with a helpful message, and rejects unknown prefixes.

## Custom Endpoint Provider Detection

Unit tests (always run). Verify that `LAT_EMBEDDING_BASE_URL` routes opaque keys to a custom OpenAI-compatible endpoint.

The tests also cover `LAT_EMBEDDING_MODEL` and `LAT_EMBEDDING_DIMENSIONS` overrides, rejection of invalid dimensions, and that replay keys still win over the env var (so the RAG replay tests remain deterministic).

## Embed Batching and Progress

Unit tests with a stubbed `globalThis.fetch` that exercise the `embed()` batching loop.

Three cases:

1. `LAT_EMBEDDING_BATCH_SIZE=3` against seven inputs — verifies batch sizes `[3, 3, 1]` and that the `onBatch(done, total)` callback fires with cumulative counts `(3,7) (6,7) (7,7)`.
2. Simulated `UND_ERR_SOCKET` from the fetch client — verifies the rethrown error mentions `LAT_EMBEDDING_BATCH_SIZE` so the user knows how to recover.
3. `LAT_EMBEDDING_BATCH_SIZE=-1` — verifies non-positive-integer values are rejected early.

## RAG Replay Tests

Functional tests that exercise the full RAG pipeline using a replay server instead of a real embedding API.

The test covers indexing, hashing, vector insert, and KNN search via `tests/rag-replay-server.ts`. Test fixture lives in `tests/cases/rag/lat.md/` with pre-recorded vectors in `tests/cases/rag/replay-data/`.

The replay server has two modes:
- **Replay** (default `pnpm test`): serves cached vectors from binary replay data. Matches requests by SHA-256 of input text.
- **Capture** (`pnpm cook-test-rag`): proxies to real API via `LAT_LLM_KEY`, records all text→vector mappings, flushes binary data to `replay-data/` on teardown. Re-run this after changing how sections are chunked or which texts are embedded.

The test sets `LAT_LLM_KEY` to `REPLAY_LAT_LLM_KEY::<server-url>`, which `detectProvider` routes to the local replay server. This way the entire codebase runs unmodified — same `fetch()` calls, same provider logic.

### Indexes all sections

Index the RAG fixture (9 sections across 2 files), verify counts.

### Finds auth section for login query

Search for "how do we handle user login and security?" and verify the Authentication section ranks first.

### Finds performance section for latency query

Search for "what tools do we use to measure response times?" and verify the Performance Tests section ranks first.

### Incremental index skips unchanged sections

Re-index unchanged content, verify all sections reported as unchanged with zero re-embedding.

### Detects deleted sections when file is removed

Remove `testing.md`, re-index, verify 4 sections removed and 5 architecture sections remain.
