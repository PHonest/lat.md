import { join, relative } from 'node:path';
import {
  loadAllSections,
  findSections,
  type Section,
  type SectionMatch,
} from '../lattice.js';
import type { CliContext } from './context.js';

const WIKI_LINK_RE = /\[\[([^\]]+)\]\]/g;

function formatLocation(section: Section, projectRoot: string): string {
  const relPath = relative(process.cwd(), join(projectRoot, section.filePath));
  return `${relPath}:${section.startLine}-${section.endLine}`;
}

type ResolvedRef = {
  target: string;
  best: SectionMatch;
  alternatives: SectionMatch[];
};

/**
 * Resolve [[refs]] in text and return the expanded output.
 * Returns null if there are no wiki links, or if resolution fails.
 */
export async function expandPrompt(
  latDir: string,
  projectRoot: string,
  text: string,
): Promise<string | null> {
  const refs = [...text.matchAll(WIKI_LINK_RE)];
  if (refs.length === 0) return null;

  const allSections = await loadAllSections(latDir);
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

  if (errors.length > 0) return null;

  // Replace [[refs]] inline
  let output = text.replace(WIKI_LINK_RE, (_match, target: string) => {
    const ref = resolved.get(target)!;
    return `[[${ref.best.section.id}]]`;
  });

  // Append context block as nested outliner
  output += '\n\n<lat-context>\n';
  for (const ref of resolved.values()) {
    const isExact =
      ref.best.reason === 'exact match' ||
      ref.best.reason.startsWith('file stem expanded');
    const all = isExact ? [ref.best] : [ref.best, ...ref.alternatives];

    if (isExact) {
      output += `* \`[[${ref.target}]]\` is referring to:\n`;
    } else {
      output += `* \`[[${ref.target}]]\` might be referring to either of the following:\n`;
    }

    for (const m of all) {
      const reason = isExact ? '' : ` (${m.reason})`;
      output += `  * [[${m.section.id}]]${reason}\n`;
      output += `    * ${formatLocation(m.section, projectRoot)}\n`;
      if (m.section.body) {
        output += `    * ${m.section.body}\n`;
      }
    }
  }
  output += '</lat-context>\n';

  return output;
}

export async function promptCmd(ctx: CliContext, text: string): Promise<void> {
  const result = await expandPrompt(ctx.latDir, ctx.projectRoot, text);

  if (result === null) {
    // Either no wiki links or resolution failed — check which
    const refs = [...text.matchAll(WIKI_LINK_RE)];
    if (refs.length === 0) {
      process.stdout.write(text);
      return;
    }

    // Resolution failed — re-run to produce error messages
    const allSections = await loadAllSections(ctx.latDir);
    for (const match of refs) {
      const target = match[1];
      const matches = findSections(allSections, target);
      if (matches.length === 0) {
        console.error(
          ctx.chalk.red(
            `No section found for [[${target}]] (no exact, substring, or fuzzy matches).`,
          ),
        );
        console.error(ctx.chalk.dim('Ask the user to correct the reference.'));
        process.exit(1);
      }
    }
    return;
  }

  process.stdout.write(result);
}
