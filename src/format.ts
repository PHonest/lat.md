import { relative } from 'node:path';
import chalk from 'chalk';
import type { Section } from './lattice.js';

export function formatSectionId(id: string): string {
  const parts = id.split('#');
  return parts.length === 1
    ? chalk.bold.white(parts[0])
    : chalk.dim(parts.slice(0, -1).join('#') + '#') +
        chalk.bold.white(parts[parts.length - 1]);
}

export function formatSectionPreview(
  section: Section,
  latticeDir: string,
  opts?: { index?: number },
): string {
  const relPath = relative(
    process.cwd(),
    latticeDir + '/' + section.file + '.md',
  );

  const prefix =
    opts?.index != null ? `${chalk.dim(`${opts.index}.`)} ` : '  ';
  const indent = opts?.index != null ? '   ' : '  ';

  const lines: string[] = [
    `${prefix}${formatSectionId(section.id)}`,
    `${indent}${chalk.dim('Defined in')} ${chalk.cyan(relPath)}${chalk.dim(`:${section.startLine}-${section.endLine}`)}`,
  ];

  if (section.body) {
    const truncated =
      section.body.length > 200
        ? section.body.slice(0, 200) + '...'
        : section.body;
    lines.push('');
    lines.push(`${indent}${chalk.dim('>')} ${truncated}`);
  }

  return lines.join('\n');
}

export function formatResultList(
  header: string,
  sections: Section[],
  latticeDir: string,
  opts?: { numbered?: boolean },
): string {
  const lines: string[] = [
    '',
    chalk.bold(header),
    '',
  ];

  for (let i = 0; i < sections.length; i++) {
    if (i > 0) lines.push('');
    lines.push(
      formatSectionPreview(sections[i], latticeDir, {
        index: opts?.numbered ? i + 1 : undefined,
      }),
    );
  }

  lines.push('');
  return lines.join('\n');
}
