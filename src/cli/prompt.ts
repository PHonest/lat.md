import { relative } from 'node:path';
import {
  loadAllSections,
  findSections,
  flattenSections,
  type Section,
} from '../lattice.js';
import type { CliContext } from './context.js';

const WIKI_LINK_RE = /\[\[([^\]]+)\]\]/g;

function formatContext(section: Section, latDir: string): string {
  const relPath = relative(
    process.cwd(),
    latDir + '/' + section.file + '.md',
  );
  const loc = `${relPath}:${section.startLine}-${section.endLine}`;
  let text = `[${section.id}](${loc})`;
  if (section.body) {
    text += `: ${section.body}`;
  }
  return text;
}

export async function promptCmd(
  ctx: CliContext,
  text: string,
): Promise<void> {
  const allSections = await loadAllSections(ctx.latDir);
  const flat = flattenSections(allSections);

  const refs = [...text.matchAll(WIKI_LINK_RE)];
  if (refs.length === 0) {
    process.stdout.write(text);
    return;
  }

  const resolved = new Map<string, Section>();

  for (const match of refs) {
    const target = match[1];
    if (resolved.has(target)) continue;

    const q = target.toLowerCase();
    const exact = flat.find((s) => s.id.toLowerCase() === q);
    if (exact) {
      resolved.set(target, exact);
      continue;
    }

    const fuzzy = findSections(allSections, target);
    if (fuzzy.length === 1) {
      resolved.set(target, fuzzy[0]);
      continue;
    }

    if (fuzzy.length > 1) {
      console.error(
        ctx.chalk.red(`Ambiguous reference [[${target}]].`),
      );
      console.error(ctx.chalk.dim('\nCould match:\n'));
      for (const m of fuzzy) {
        console.error('  ' + m.id);
      }
      console.error(
        ctx.chalk.dim('\nAsk the user which section they meant.'),
      );
      process.exit(1);
    }

    console.error(
      ctx.chalk.red(
        `No section found for [[${target}]] (no exact, substring, or fuzzy matches).`,
      ),
    );
    console.error(
      ctx.chalk.dim('Ask the user to correct the reference.'),
    );
    process.exit(1);
  }

  // Replace [[refs]] inline
  let output = text.replace(WIKI_LINK_RE, (_match, target: string) => {
    const section = resolved.get(target)!;
    return `[[${section.id}]]`;
  });

  // Append context block
  output += '\n\n<lat-context>\n';
  for (const section of resolved.values()) {
    output += formatContext(section, ctx.latDir) + '\n';
  }
  output += '</lat-context>\n';

  process.stdout.write(output);
}
