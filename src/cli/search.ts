import chalk from 'chalk';
import type { CliContext } from './context.js';
import { openDb, ensureSchema, closeDb } from '../search/db.js';
import { detectProvider } from '../search/provider.js';
import { indexSections } from '../search/index.js';
import { searchSections } from '../search/search.js';
import { loadAllSections, flattenSections } from '../lattice.js';
import { formatResultList } from '../format.js';
import { getLlmKey, getConfigPath } from '../config.js';

export async function searchCmd(
  ctx: CliContext,
  query: string | undefined,
  opts: { limit: number; reindex?: boolean },
): Promise<void> {
  let key: string | undefined;
  try {
    key = getLlmKey();
  } catch (err) {
    console.error(chalk.red((err as Error).message));
    process.exit(1);
  }
  if (!key) {
    console.error(
      chalk.red('No API key configured.') +
        ' Provide a key via LAT_LLM_KEY, LAT_LLM_KEY_FILE, LAT_LLM_KEY_HELPER, or run ' +
        chalk.cyan('lat init') +
        ' to save one in ' +
        chalk.dim(getConfigPath()) +
        '.',
    );
    process.exit(1);
  }

  const provider = detectProvider(key);
  const db = openDb(ctx.latDir);

  try {
    await ensureSchema(db, provider.dimensions);

    // Check if index needs updating
    const countResult = await db.execute('SELECT COUNT(*) as n FROM sections');
    const isEmpty = (countResult.rows[0].n as number) === 0;

    if (isEmpty || opts.reindex) {
      const label = opts.reindex ? 'Re-indexing' : 'Building index';
      process.stderr.write(chalk.dim(`${label}...`));
      const stats = await indexSections(ctx.latDir, db, provider, key);
      process.stderr.write(
        chalk.dim(
          ` done (${stats.added} added, ${stats.updated} updated, ${stats.removed} removed)\n`,
        ),
      );
    } else {
      // Incremental update
      const stats = await indexSections(ctx.latDir, db, provider, key);
      if (stats.added + stats.updated + stats.removed > 0) {
        process.stderr.write(
          chalk.dim(
            `Index updated: ${stats.added} added, ${stats.updated} updated, ${stats.removed} removed\n`,
          ),
        );
      }
    }

    if (!query) return;

    const results = await searchSections(db, query, provider, key, opts.limit);

    if (results.length === 0) {
      console.log(chalk.dim('No results found.'));
      return;
    }

    // Load sections for formatting with location info
    const allSections = await loadAllSections(ctx.latDir);
    const flat = flattenSections(allSections);
    const byId = new Map(flat.map((s) => [s.id, s]));

    const matched = results
      .map((r) => byId.get(r.id))
      .filter((s): s is NonNullable<typeof s> => !!s)
      .map((s) => ({ section: s, reason: 'semantic match' }));

    console.log(
      formatResultList(
        `Search results for "${query}":`,
        matched,
        ctx.projectRoot,
      ),
    );
    console.log(
      '\nTo navigate further:\n' +
        '- `lat locate "Section Name"` — jump to a section by name\n' +
        '- `lat refs "section#id"` — find what references a section\n' +
        '- `lat search "new query"` — search for something else',
    );
  } finally {
    await closeDb(db);
  }
}
