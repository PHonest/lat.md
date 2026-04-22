import type { EmbeddingProvider } from './provider.js';

const DEFAULT_MAX_BATCH = 2048;

function getMaxBatch(): number {
  const raw = process.env.LAT_EMBEDDING_BATCH_SIZE?.trim();
  if (!raw) return DEFAULT_MAX_BATCH;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(
      `LAT_EMBEDDING_BATCH_SIZE must be a positive integer, got "${raw}".`,
    );
  }
  return parsed;
}

export type EmbedProgress = {
  onBatch?: (done: number, total: number) => void;
};

export async function embed(
  texts: string[],
  provider: EmbeddingProvider,
  key: string,
  progress?: EmbedProgress,
): Promise<number[][]> {
  const maxBatch = getMaxBatch();
  const results: number[][] = [];

  for (let i = 0; i < texts.length; i += maxBatch) {
    const batch = texts.slice(i, i + maxBatch);
    let resp: Response;
    try {
      resp = await fetch(`${provider.apiBase}/embeddings`, {
        method: 'POST',
        headers: provider.headers(key),
        body: JSON.stringify({
          model: provider.model,
          input: batch,
          encoding_format: 'float',
        }),
      });
    } catch (err) {
      const cause = (err as Error & { cause?: { code?: string } }).cause;
      const code = cause?.code;
      if (code === 'UND_ERR_SOCKET' || code === 'ECONNRESET') {
        throw new Error(
          `Embedding request failed: ${(err as Error).message} (cause: ${code}). ` +
            `The server closed the connection mid-response — this typically means the batch ` +
            `response exceeded a proxy/server size or time limit. Lower LAT_EMBEDDING_BATCH_SIZE ` +
            `(currently ${maxBatch}); 64 is a safe starting point for self-hosted vLLM.`,
        );
      }
      throw err;
    }

    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(
        `Embedding API error (${resp.status}): ${body.slice(0, 2000)}`,
      );
    }

    const json = (await resp.json()) as {
      data: { embedding: number[]; index: number }[];
    };
    const sorted = json.data.sort((a, b) => a.index - b.index);
    for (const item of sorted) {
      results.push(item.embedding);
    }
    progress?.onBatch?.(Math.min(i + batch.length, texts.length), texts.length);
  }

  return results;
}
