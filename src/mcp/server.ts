import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { relative } from 'node:path';
import {
  findLatticeDir,
  loadAllSections,
  findSections,
  flattenSections,
  buildFileIndex,
  resolveRef,
  extractRefs,
  listLatticeFiles,
  type Section,
  type SectionMatch,
} from '../lattice.js';
import { scanCodeRefs } from '../code-refs.js';
import { checkMd, checkCodeRefs, checkIndex } from '../cli/check.js';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

function formatSection(s: Section, latDir: string): string {
  const relPath = relative(process.cwd(), latDir + '/' + s.file + '.md');
  const kind = s.id.includes('#') ? 'Section' : 'File';
  const lines = [
    `* ${kind}: [[${s.id}]]`,
    `  Defined in ${relPath}:${s.startLine}-${s.endLine}`,
  ];
  if (s.body) {
    const truncated =
      s.body.length > 200 ? s.body.slice(0, 200) + '...' : s.body;
    lines.push('', `  > ${truncated}`);
  }
  return lines.join('\n');
}

function formatMatches(
  header: string,
  matches: SectionMatch[],
  latDir: string,
): string {
  const lines = [header, ''];
  for (let i = 0; i < matches.length; i++) {
    if (i > 0) lines.push('');
    lines.push(
      formatSection(matches[i].section, latDir) + ` (${matches[i].reason})`,
    );
  }
  return lines.join('\n');
}

export async function startMcpServer(): Promise<void> {
  const latDir = findLatticeDir();
  if (!latDir) {
    process.stderr.write('No lat.md directory found\n');
    process.exit(1);
  }

  const server = new McpServer({
    name: 'lat',
    version: '1.0.0',
  });

  server.tool(
    'lat_locate',
    'Find sections by name (exact, fuzzy, subsequence matching)',
    { query: z.string().describe('Section name or id to search for') },
    async ({ query }) => {
      const sections = await loadAllSections(latDir);
      const matches = findSections(sections, query.replace(/^\[\[|\]\]$/g, ''));
      if (matches.length === 0) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `No sections matching "${query}"`,
            },
          ],
        };
      }
      return {
        content: [
          {
            type: 'text' as const,
            text: formatMatches(
              `Sections matching "${query}":`,
              matches,
              latDir,
            ),
          },
        ],
      };
    },
  );

  server.tool(
    'lat_search',
    'Semantic search across lat.md sections using embeddings',
    {
      query: z.string().describe('Search query in natural language'),
      limit: z
        .number()
        .optional()
        .default(5)
        .describe('Max results (default 5)'),
    },
    async ({ query, limit }) => {
      const key = process.env.LAT_LLM_KEY;
      if (!key) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'LAT_LLM_KEY is not set. Set it to an OpenAI (sk-...) or Vercel AI (vck_...) key.',
            },
          ],
          isError: true,
        };
      }

      const { detectProvider } = await import('../search/provider.js');
      const { openDb, ensureSchema, closeDb } = await import('../search/db.js');
      const { indexSections } = await import('../search/index.js');
      const { searchSections } = await import('../search/search.js');

      const provider = detectProvider(key);
      const db = openDb(latDir);

      try {
        await ensureSchema(db, provider.dimensions);
        await indexSections(latDir, db, provider, key);

        const results = await searchSections(db, query, provider, key, limit);
        if (results.length === 0) {
          return {
            content: [{ type: 'text' as const, text: 'No results found.' }],
          };
        }

        const allSections = await loadAllSections(latDir);
        const flat = flattenSections(allSections);
        const byId = new Map(flat.map((s) => [s.id, s]));

        const matched = results
          .map((r) => byId.get(r.id))
          .filter((s): s is NonNullable<typeof s> => !!s)
          .map((s) => ({ section: s, reason: 'semantic match' }));

        return {
          content: [
            {
              type: 'text' as const,
              text: formatMatches(
                `Search results for "${query}":`,
                matched,
                latDir,
              ),
            },
          ],
        };
      } finally {
        await closeDb(db);
      }
    },
  );

  server.tool(
    'lat_prompt',
    'Expand [[refs]] in text to resolved lat.md section paths with context',
    { text: z.string().describe('Text containing [[refs]] to expand') },
    async ({ text }) => {
      const WIKI_LINK_RE = /\[\[([^\]]+)\]\]/g;
      const allSections = await loadAllSections(latDir);

      const refs = [...text.matchAll(WIKI_LINK_RE)];
      if (refs.length === 0) {
        return {
          content: [{ type: 'text' as const, text }],
        };
      }

      type ResolvedRef = {
        target: string;
        best: SectionMatch;
        alternatives: SectionMatch[];
      };

      const resolved = new Map<string, ResolvedRef>();
      const errors: string[] = [];

      for (const match of refs) {
        const target = match[1];
        if (resolved.has(target)) continue;

        const matches = findSections(allSections, target);
        if (matches.length >= 1) {
          resolved.set(target, {
            target,
            best: matches[0],
            alternatives: matches.slice(1),
          });
        } else {
          errors.push(`No section found for [[${target}]]`);
        }
      }

      if (errors.length > 0) {
        return {
          content: [{ type: 'text' as const, text: errors.join('\n') }],
          isError: true,
        };
      }

      let output = text.replace(
        WIKI_LINK_RE,
        (_match: string, target: string) => {
          const ref = resolved.get(target)!;
          return `[[${ref.best.section.id}]]`;
        },
      );

      output += '\n\n<lat-context>\n';
      for (const ref of resolved.values()) {
        const isExact = ref.best.reason === 'exact match';
        const all = isExact ? [ref.best] : [ref.best, ...ref.alternatives];

        if (isExact) {
          output += `* [[${ref.target}]] is referring to:\n`;
        } else {
          output += `* [[${ref.target}]] might be referring to either of the following:\n`;
        }

        for (const m of all) {
          const reason = isExact ? '' : ` (${m.reason})`;
          const relPath = relative(
            process.cwd(),
            latDir + '/' + m.section.file + '.md',
          );
          output += `  * [[${m.section.id}]]${reason}\n`;
          output += `    * ${relPath}:${m.section.startLine}-${m.section.endLine}\n`;
          if (m.section.body) {
            output += `    * ${m.section.body}\n`;
          }
        }
      }
      output += '</lat-context>\n';

      return {
        content: [{ type: 'text' as const, text: output }],
      };
    },
  );

  server.tool(
    'lat_check',
    'Validate all wiki links, code references, and directory indexes in lat.md',
    {},
    async () => {
      const md = await checkMd(latDir);
      const code = await checkCodeRefs(latDir);
      const indexErrors = await checkIndex(latDir);

      const allErrors = [...md.errors, ...code.errors];
      const lines: string[] = [];

      for (const err of allErrors) {
        lines.push(`${err.file}:${err.line}: ${err.message}`);
      }
      for (const err of indexErrors) {
        lines.push(`${err.dir}: ${err.message}`);
      }

      const totalErrors = allErrors.length + indexErrors.length;
      if (totalErrors === 0) {
        return {
          content: [{ type: 'text' as const, text: 'All checks passed' }],
        };
      }

      lines.push(`\n${totalErrors} error${totalErrors === 1 ? '' : 's'} found`);
      return {
        content: [{ type: 'text' as const, text: lines.join('\n') }],
        isError: true,
      };
    },
  );

  server.tool(
    'lat_refs',
    'Find sections that reference a given section via wiki links or @lat code comments',
    {
      query: z.string().describe('Section id to find references for'),
      scope: z
        .enum(['md', 'code', 'md+code'])
        .optional()
        .default('md')
        .describe('Where to search: md, code, or md+code'),
    },
    async ({ query, scope }) => {
      const allSections = await loadAllSections(latDir);
      const flat = flattenSections(allSections);
      const sectionIds = new Set(flat.map((s) => s.id.toLowerCase()));
      const fileIndex = buildFileIndex(allSections);
      const { resolved } = resolveRef(query, sectionIds, fileIndex);
      const q = resolved.toLowerCase();
      const exactMatch = flat.find((s) => s.id.toLowerCase() === q);

      if (!exactMatch) {
        const matches = findSections(allSections, query);
        if (matches.length > 0) {
          const suggestions = matches
            .map((m) => `  * ${m.section.id} (${m.reason})`)
            .join('\n');
          return {
            content: [
              {
                type: 'text' as const,
                text: `No exact section "${query}" found. Did you mean:\n${suggestions}`,
              },
            ],
          };
        }
        return {
          content: [
            {
              type: 'text' as const,
              text: `No section matching "${query}"`,
            },
          ],
        };
      }

      const targetId = exactMatch.id.toLowerCase();
      const mdMatches: SectionMatch[] = [];
      const codeLines: string[] = [];

      if (scope === 'md' || scope === 'md+code') {
        const files = await listLatticeFiles(latDir);
        const matchingFromSections = new Set<string>();
        for (const file of files) {
          const content = await readFile(file, 'utf-8');
          const fileRefs = extractRefs(file, content, latDir);
          for (const ref of fileRefs) {
            const { resolved: refResolved } = resolveRef(
              ref.target,
              sectionIds,
              fileIndex,
            );
            if (refResolved.toLowerCase() === targetId) {
              matchingFromSections.add(ref.fromSection.toLowerCase());
            }
          }
        }

        if (matchingFromSections.size > 0) {
          const referrers = flat.filter((s) =>
            matchingFromSections.has(s.id.toLowerCase()),
          );
          for (const s of referrers) {
            mdMatches.push({ section: s, reason: 'wiki link' });
          }
        }
      }

      if (scope === 'code' || scope === 'md+code') {
        const projectRoot = join(latDir, '..');
        const { refs: codeRefs } = await scanCodeRefs(projectRoot);
        for (const ref of codeRefs) {
          const { resolved: codeResolved } = resolveRef(
            ref.target,
            sectionIds,
            fileIndex,
          );
          if (codeResolved.toLowerCase() === targetId) {
            codeLines.push(`${ref.file}:${ref.line}`);
          }
        }
      }

      if (mdMatches.length === 0 && codeLines.length === 0) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `No references to "${exactMatch.id}" found`,
            },
          ],
        };
      }

      const parts: string[] = [];
      if (mdMatches.length > 0) {
        parts.push(
          formatMatches(`References to "${exactMatch.id}":`, mdMatches, latDir),
        );
      }
      if (codeLines.length > 0) {
        parts.push(
          'Code references:\n' + codeLines.map((l) => `* ${l}`).join('\n'),
        );
      }

      return {
        content: [{ type: 'text' as const, text: parts.join('\n\n') }],
      };
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
