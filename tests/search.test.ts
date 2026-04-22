import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { mkdtempSync, rmSync, cpSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  detectProvider,
  type EmbeddingProvider,
} from '../src/search/provider.js';
import { embed } from '../src/search/embeddings.js';
import { openDb, ensureSchema, closeDb } from '../src/search/db.js';
import { indexSections } from '../src/search/index.js';
import { searchSections } from '../src/search/search.js';
import { startReplayServer, hasReplayData } from './rag-replay-server.js';
import type { Client } from '@libsql/client';
import type { Server } from 'node:http';

// --- Unit tests (always run) ---

// @lat: [[search#Provider Detection]]
describe('detectProvider', () => {
  it('detects OpenAI key', () => {
    const p = detectProvider('sk-abc123');
    expect(p.name).toBe('openai');
  });

  it('detects Vercel key', () => {
    const p = detectProvider('vck_abc123');
    expect(p.name).toBe('vercel');
  });

  it('rejects Anthropic key with helpful message', () => {
    expect(() => detectProvider('sk-ant-abc123')).toThrow(/Anthropic/);
  });

  it('rejects unknown key', () => {
    expect(() => detectProvider('xyz_abc123')).toThrow(/Unrecognized/);
  });
});

// @lat: [[search#Custom Endpoint Provider Detection]]
describe('detectProvider custom endpoint', () => {
  afterEach(() => {
    delete process.env.LAT_EMBEDDING_BASE_URL;
    delete process.env.LAT_EMBEDDING_MODEL;
    delete process.env.LAT_EMBEDDING_DIMENSIONS;
  });

  it('routes any key to the custom endpoint when LAT_EMBEDDING_BASE_URL is set', () => {
    process.env.LAT_EMBEDDING_BASE_URL = 'https://litellm.example.com/v1';
    const p = detectProvider('any-opaque-token');
    expect(p.name).toBe('custom');
    expect(p.apiBase).toBe('https://litellm.example.com/v1');
    expect(p.model).toBe('text-embedding-3-small');
    expect(p.dimensions).toBe(1536);
    expect(p.headers('any-opaque-token')).toMatchObject({
      Authorization: 'Bearer any-opaque-token',
    });
  });

  it('honors LAT_EMBEDDING_MODEL and LAT_EMBEDDING_DIMENSIONS overrides', () => {
    process.env.LAT_EMBEDDING_BASE_URL = 'https://litellm.example.com/v1/';
    process.env.LAT_EMBEDDING_MODEL = 'bge-m3';
    process.env.LAT_EMBEDDING_DIMENSIONS = '1024';
    const p = detectProvider('sk-anything');
    expect(p.apiBase).toBe('https://litellm.example.com/v1');
    expect(p.model).toBe('bge-m3');
    expect(p.dimensions).toBe(1024);
  });

  it('rejects invalid LAT_EMBEDDING_DIMENSIONS', () => {
    process.env.LAT_EMBEDDING_BASE_URL = 'https://litellm.example.com/v1';
    process.env.LAT_EMBEDDING_DIMENSIONS = 'not-a-number';
    expect(() => detectProvider('sk-anything')).toThrow(
      /LAT_EMBEDDING_DIMENSIONS/,
    );
  });

  it('replay keys still win over LAT_EMBEDDING_BASE_URL', () => {
    process.env.LAT_EMBEDDING_BASE_URL = 'https://litellm.example.com/v1';
    const p = detectProvider('REPLAY_LAT_LLM_KEY::http://localhost:1234');
    expect(p.name).toBe('replay');
    expect(p.apiBase).toBe('http://localhost:1234');
  });
});

// @lat: [[search#Embed Batching and Progress]]
describe('embed batching and progress', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
    delete process.env.LAT_EMBEDDING_BATCH_SIZE;
  });

  const makeProvider = (): EmbeddingProvider => ({
    name: 'mock',
    apiBase: 'https://mock.example.com/v1',
    model: 'mock-model',
    dimensions: 2,
    headers: () => ({ 'Content-Type': 'application/json' }),
  });

  it('splits inputs into batches of LAT_EMBEDDING_BATCH_SIZE and reports progress', async () => {
    process.env.LAT_EMBEDDING_BATCH_SIZE = '3';
    let call = 0;
    const batchSizes: number[] = [];
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      call++;
      const body = JSON.parse(init.body as string) as { input: string[] };
      batchSizes.push(body.input.length);
      return new Response(
        JSON.stringify({
          data: body.input.map((_, idx) => ({
            embedding: [idx, call],
            index: idx,
          })),
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;

    const events: Array<[number, number]> = [];
    const vectors = await embed(
      ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
      makeProvider(),
      'test-key',
      { onBatch: (done, total) => events.push([done, total]) },
    );

    expect(batchSizes).toEqual([3, 3, 1]);
    expect(vectors).toHaveLength(7);
    expect(events).toEqual([
      [3, 7],
      [6, 7],
      [7, 7],
    ]);
  });

  it('surfaces a helpful message when the socket closes mid-response', async () => {
    process.env.LAT_EMBEDDING_BATCH_SIZE = '10';
    globalThis.fetch = (async () => {
      const err = new TypeError('fetch failed');
      (err as Error & { cause?: unknown }).cause = { code: 'UND_ERR_SOCKET' };
      throw err;
    }) as typeof fetch;

    await expect(embed(['a', 'b'], makeProvider(), 'test-key')).rejects.toThrow(
      /LAT_EMBEDDING_BATCH_SIZE/,
    );
  });

  it('rejects invalid LAT_EMBEDDING_BATCH_SIZE', async () => {
    process.env.LAT_EMBEDDING_BATCH_SIZE = '-1';
    await expect(embed(['a'], makeProvider(), 'test-key')).rejects.toThrow(
      /LAT_EMBEDDING_BATCH_SIZE/,
    );
  });
});

// --- RAG functional tests ---
//
// Two modes:
// - Normal (default): replays cached vectors from tests/cases/rag/replay-data/
// - Capture (_LAT_TEST_CAPTURE_EMBEDDINGS=1): proxies to real API via LAT_LLM_KEY,
//   records vectors to replay-data/, then runs assertions against live results
//
// To re-cook: pnpm cook-test-rag

const capturing = !!process.env._LAT_TEST_CAPTURE_EMBEDDINGS;
const replayDir = join(import.meta.dirname, 'cases', 'rag', 'replay-data');
const canRun = capturing || hasReplayData(replayDir);

describe.skipIf(!canRun)('search (rag)', () => {
  let tmp: string;
  let latDir: string;
  let db: Client;
  let server: Server;
  let provider: EmbeddingProvider;
  let replayKey: string;
  let flushCapture: () => void;

  beforeAll(async () => {
    if (capturing) {
      // Capture mode: proxy to real API, record vectors
      const realKey = process.env.LAT_LLM_KEY;
      if (!realKey) throw new Error('LAT_LLM_KEY must be set in capture mode');
      const realProvider = detectProvider(realKey);

      const replay = await startReplayServer(replayDir, {
        capture: true,
        provider: realProvider,
        key: realKey,
      });
      server = replay.server;
      flushCapture = replay.flush;
      replayKey = `REPLAY_LAT_LLM_KEY::${replay.url}`;
      provider = detectProvider(replayKey);
    } else {
      // Replay mode: serve cached vectors
      const replay = await startReplayServer(replayDir);
      server = replay.server;
      flushCapture = replay.flush;
      replayKey = `REPLAY_LAT_LLM_KEY::${replay.url}`;
      provider = detectProvider(replayKey);
    }

    // Copy fixture to tmp so .cache doesn't pollute the repo
    tmp = mkdtempSync(join(tmpdir(), 'lat-rag-'));
    latDir = join(tmp, 'lat.md');
    cpSync(join(import.meta.dirname, 'cases', 'rag', 'lat.md'), latDir, {
      recursive: true,
    });

    db = openDb(latDir);
    await ensureSchema(db, provider.dimensions);
  });

  afterAll(async () => {
    if (capturing) flushCapture();
    if (db) await closeDb(db);
    if (server) server.close();
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  // @lat: [[search#RAG Replay Tests#Indexes all sections]]
  it('indexes all sections', async () => {
    const stats = await indexSections(latDir, db, provider, replayKey);
    expect(stats.added).toBe(9);
    expect(stats.updated).toBe(0);
    expect(stats.removed).toBe(0);
    expect(stats.unchanged).toBe(0);
  });

  // @lat: [[search#RAG Replay Tests#Finds auth section for login query]]
  it('finds auth section for login query', async () => {
    const results = await searchSections(
      db,
      'how do we handle user login and security?',
      provider,
      replayKey,
    );
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].id).toContain('Authentication');
  });

  // @lat: [[search#RAG Replay Tests#Finds performance section for latency query]]
  it('finds performance section for latency query', async () => {
    const results = await searchSections(
      db,
      'what tools do we use to measure response times?',
      provider,
      replayKey,
    );
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].id).toContain('Performance');
  });

  // @lat: [[search#RAG Replay Tests#Incremental index skips unchanged sections]]
  it('incremental index skips unchanged sections', async () => {
    const stats = await indexSections(latDir, db, provider, replayKey);
    expect(stats.unchanged).toBe(9);
    expect(stats.added).toBe(0);
    expect(stats.updated).toBe(0);
    expect(stats.removed).toBe(0);
  });

  // @lat: [[search#RAG Replay Tests#Detects deleted sections when file is removed]]
  it('detects deleted sections when file is removed', async () => {
    rmSync(join(latDir, 'testing.md'));

    const stats = await indexSections(latDir, db, provider, replayKey);
    expect(stats.removed).toBe(4); // testing + unit + integration + performance
    expect(stats.unchanged).toBe(5); // architecture sections remain
  });
});
