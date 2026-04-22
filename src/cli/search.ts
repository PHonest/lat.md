import type { CmdContext, CmdResult, Styler } from '../context.js';
import { openDb, ensureSchema, closeDb } from '../search/db.js';
import { detectProvider } from '../search/provider.js';
import { indexSections, type IndexStats } from '../search/index.js';
import type { EmbedProgress } from '../search/embeddings.js';
import { searchSections } from '../search/search.js';
import {
  loadAllSections,
  flattenSections,
  type SectionMatch,
} from '../lattice.js';
import { formatResultList, formatNavHints } from '../format.js';

export type SearchResult = {
  query: string;
  matches: SectionMatch[];
};

export type IndexProgress = {
  /** Called before indexing starts. `isEmpty` is true on first run. */
  beforeIndex?: (isEmpty: boolean) => void;
  /** Called after each batch of embeddings completes. */
  onEmbedBatch?: (done: number, total: number) => void;
  /** Called after indexing completes with stats. */
  afterIndex?: (stats: IndexStats, isEmpty: boolean) => void;
};

async function withDb<T>(
  latDir: string,
  key: string,
  progress: IndexProgress | undefined,
  fn: (
    db: Awaited<ReturnType<typeof openDb>>,
    provider: ReturnType<typeof detectProvider>,
  ) => Promise<T>,
): Promise<T> {
  const provider = detectProvider(key);
  const db = openDb(latDir);

  try {
    await ensureSchema(db, provider.dimensions);

    const countResult = await db.execute('SELECT COUNT(*) as n FROM sections');
    const isEmpty = (countResult.rows[0].n as number) === 0;

    progress?.beforeIndex?.(isEmpty);
    const embedProgress: EmbedProgress = {
      onBatch: (done, total) => progress?.onEmbedBatch?.(done, total),
    };
    const stats = await indexSections(latDir, db, provider, key, embedProgress);
    progress?.afterIndex?.(stats, isEmpty);

    return await fn(db, provider);
  } finally {
    await closeDb(db);
  }
}

/**
 * Run a semantic search across lat.md sections.
 * Handles indexing (with optional progress callback). Returns matched sections.
 */
export async function runSearch(
  latDir: string,
  query: string,
  key: string,
  limit: number,
  progress?: IndexProgress,
): Promise<SearchResult> {
  return withDb(latDir, key, progress, async (db, provider) => {
    const results = await searchSections(db, query, provider, key, limit);
    if (results.length === 0) {
      return { query, matches: [] };
    }

    const allSections = await loadAllSections(latDir);
    const flat = flattenSections(allSections);
    const byId = new Map(flat.map((s) => [s.id, s]));

    const matches = results
      .map((r) => byId.get(r.id))
      .filter((s): s is NonNullable<typeof s> => !!s)
      .map((s) => ({ section: s, reason: 'semantic match' }));

    return { query, matches };
  });
}

/**
 * Index-only mode (no query). Used by `lat search --reindex`.
 */
export async function runIndex(
  latDir: string,
  key: string,
  progress?: IndexProgress,
): Promise<void> {
  await withDb(latDir, key, progress, async () => {});
}

function renderBar(done: number, total: number, width = 24): string {
  if (total <= 0) return '';
  const ratio = Math.max(0, Math.min(1, done / total));
  const filled = Math.round(ratio * width);
  const bar = '█'.repeat(filled) + '░'.repeat(width - filled);
  const pct = Math.round(ratio * 100);
  return `[${bar}] ${done}/${total} (${pct}%)`;
}

export function cliProgress(reindex: boolean, s: Styler): IndexProgress {
  const isTty = Boolean(process.stderr.isTTY);
  let barActive = false;

  const clearBar = () => {
    if (barActive && isTty) {
      process.stderr.write('\r\x1b[K');
      barActive = false;
    }
  };

  return {
    beforeIndex(isEmpty) {
      if (isEmpty || reindex) {
        const label = reindex ? 'Re-indexing' : 'Building index';
        process.stderr.write(s.dim(`${label}...`));
      }
    },
    onEmbedBatch(done, total) {
      if (!(reindex || barActive) && done < total) {
        process.stderr.write(s.dim(' embedding...'));
      }
      if (isTty) {
        process.stderr.write('\r\x1b[K' + s.dim(renderBar(done, total)));
        barActive = true;
      } else if (done === total) {
        process.stderr.write(s.dim(` ${done}/${total}`));
      }
    },
    afterIndex(stats, isEmpty) {
      clearBar();
      if (isEmpty || reindex) {
        process.stderr.write(
          s.dim(
            ` done (${stats.added} added, ${stats.updated} updated, ${stats.removed} removed)\n`,
          ),
        );
      } else if (stats.added + stats.updated + stats.removed > 0) {
        process.stderr.write(
          s.dim(
            `Index updated: ${stats.added} added, ${stats.updated} updated, ${stats.removed} removed\n`,
          ),
        );
      }
    },
  };
}

export async function searchCommand(
  ctx: CmdContext,
  query: string | undefined,
  opts: { limit: number; reindex?: boolean },
  progress?: IndexProgress,
): Promise<CmdResult> {
  const { getLlmKey, getConfigPath } = await import('../config.js');
  let key: string | undefined;
  try {
    key = getLlmKey();
  } catch (err) {
    return { output: (err as Error).message, isError: true };
  }
  if (!key) {
    const s = ctx.styler;
    return {
      output:
        s.red('No API key configured.') +
        ' Provide a key via LAT_LLM_KEY, LAT_LLM_KEY_FILE, LAT_LLM_KEY_HELPER, or run ' +
        s.cyan('lat init') +
        (ctx.mode === 'cli'
          ? ' to save one in ' + s.dim(getConfigPath())
          : '') +
        '.',
      isError: true,
    };
  }

  if (!query) {
    await runIndex(ctx.latDir, key, progress);
    return { output: '' };
  }

  const result = await runSearch(ctx.latDir, query, key, opts.limit, progress);

  if (result.matches.length === 0) {
    return { output: 'No results found.' };
  }

  return {
    output:
      formatResultList(ctx, `Search results for "${query}":`, result.matches) +
      formatNavHints(ctx),
  };
}
