/**
 * Cook replay data for the RAG test case.
 *
 * Runs the search test in capture mode — proxies to the real embedding API
 * (via LAT_LLM_KEY) and records all vectors to tests/cases/rag/replay-data/.
 *
 * Usage: pnpm cook-test-rag  (requires LAT_LLM_KEY in env)
 */

import { execSync } from 'node:child_process'

if (!process.env.LAT_LLM_KEY) {
  console.error('LAT_LLM_KEY must be set to a real API key')
  process.exit(1)
}

execSync('pnpm test -- tests/search.test.ts', {
  stdio: 'inherit',
  env: { ...process.env, _LAT_TEST_CAPTURE_EMBEDDINGS: '1' },
})
