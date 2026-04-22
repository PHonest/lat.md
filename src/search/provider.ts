export type EmbeddingProvider = {
  name: string;
  apiBase: string;
  model: string;
  dimensions: number;
  headers: (key: string) => Record<string, string>;
};

const openai: EmbeddingProvider = {
  name: 'openai',
  apiBase: 'https://api.openai.com/v1',
  model: 'text-embedding-3-small',
  dimensions: 1536,
  headers: (key) => ({
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
  }),
};

const vercel: EmbeddingProvider = {
  name: 'vercel',
  apiBase: 'https://ai-gateway.vercel.sh/v1',
  model: 'openai/text-embedding-3-small',
  dimensions: 1536,
  headers: (key) => ({
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
  }),
};

export function detectProvider(key: string): EmbeddingProvider {
  if (key.startsWith('REPLAY_LAT_LLM_KEY::')) {
    const replayUrl = key.slice('REPLAY_LAT_LLM_KEY::'.length);
    return {
      name: 'replay',
      apiBase: replayUrl,
      model: 'replay',
      dimensions: 1536,
      headers: () => ({ 'Content-Type': 'application/json' }),
    };
  }
  const customBase = process.env.LAT_EMBEDDING_BASE_URL?.trim();
  if (customBase) {
    const dimsRaw = process.env.LAT_EMBEDDING_DIMENSIONS?.trim();
    let dimensions = 1536;
    if (dimsRaw) {
      const parsed = Number(dimsRaw);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error(
          `LAT_EMBEDDING_DIMENSIONS must be a positive integer, got "${dimsRaw}".`,
        );
      }
      dimensions = parsed;
    }
    return {
      name: 'custom',
      apiBase: customBase.replace(/\/+$/, ''),
      model:
        process.env.LAT_EMBEDDING_MODEL?.trim() || 'text-embedding-3-small',
      dimensions,
      headers: (k) => ({
        Authorization: `Bearer ${k}`,
        'Content-Type': 'application/json',
      }),
    };
  }
  if (key.startsWith('sk-ant-')) {
    throw new Error(
      "Anthropic doesn't offer an embedding model. Set LAT_LLM_KEY to an OpenAI (sk-...) or Vercel AI Gateway (vck_...) key, or point LAT_EMBEDDING_BASE_URL at an OpenAI-compatible endpoint.",
    );
  }
  if (key.startsWith('vck_')) return vercel;
  if (key.startsWith('sk-')) return openai;
  throw new Error(
    `Unrecognized LAT_LLM_KEY prefix. Supported: OpenAI (sk-...), Vercel AI Gateway (vck_...). For other OpenAI-compatible endpoints, set LAT_EMBEDDING_BASE_URL.`,
  );
}
