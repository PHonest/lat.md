import { readFile } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';
import {
  listLatticeFiles,
  loadAllSections,
  extractRefs,
  flattenSections,
  parseFrontmatter,
  parseSections,
  type Section,
} from '../lattice.js';
import { scanCodeRefs } from '../code-refs.js';
import type { CliContext } from './context.js';

export type CheckError = {
  file: string;
  line: number;
  target: string;
  message: string;
};

/** File counts grouped by extension (e.g. { ".ts": 5, ".py": 2 }). */
export type FileStats = Record<string, number>;

export type CheckResult = {
  errors: CheckError[];
  files: FileStats;
};

function countByExt(paths: string[]): FileStats {
  const stats: FileStats = {};
  for (const p of paths) {
    const ext = extname(p) || '(no ext)';
    stats[ext] = (stats[ext] || 0) + 1;
  }
  return stats;
}

export async function checkMd(latticeDir: string): Promise<CheckResult> {
  const files = await listLatticeFiles(latticeDir);
  const allSections = await loadAllSections(latticeDir);
  const flat = flattenSections(allSections);
  const sectionIds = new Set(flat.map((s) => s.id.toLowerCase()));

  const errors: CheckError[] = [];

  for (const file of files) {
    const content = await readFile(file, 'utf-8');
    const refs = extractRefs(file, content);
    const relPath = relative(process.cwd(), file);

    for (const ref of refs) {
      const target = ref.target.toLowerCase();
      if (!sectionIds.has(target)) {
        errors.push({
          file: relPath,
          line: ref.line,
          target: ref.target,
          message: `broken link [[${ref.target}]] — no matching section found`,
        });
      }
    }
  }

  return { errors, files: countByExt(files) };
}

export async function checkCodeRefs(
  latticeDir: string,
): Promise<CheckResult> {
  const projectRoot = join(latticeDir, '..');
  const allSections = await loadAllSections(latticeDir);
  const flat = flattenSections(allSections);
  const sectionIds = new Set(flat.map((s) => s.id.toLowerCase()));

  const scan = await scanCodeRefs(projectRoot);
  const errors: CheckError[] = [];

  const mentionedSections = new Set<string>();
  for (const ref of scan.refs) {
    const target = ref.target.toLowerCase();
    mentionedSections.add(target);
    if (!sectionIds.has(target)) {
      errors.push({
        file: ref.file,
        line: ref.line,
        target: ref.target,
        message: `@lat: [[${ref.target}]] — no matching section found`,
      });
    }
  }

  const files = await listLatticeFiles(latticeDir);
  for (const file of files) {
    const content = await readFile(file, 'utf-8');
    const fm = parseFrontmatter(content);
    if (!fm.requireCodeMention) continue;

    const sections = parseSections(file, content);
    const fileSections = flattenSections(sections);
    const leafSections = fileSections.filter((s) => s.children.length === 0);
    const relPath = relative(process.cwd(), file);

    for (const leaf of leafSections) {
      if (!mentionedSections.has(leaf.id.toLowerCase())) {
        errors.push({
          file: relPath,
          line: leaf.startLine,
          target: leaf.id,
          message: `section "${leaf.id}" requires a code mention but none found`,
        });
      }
    }
  }

  return { errors, files: countByExt(scan.files) };
}

function formatErrors(ctx: CliContext, errors: CheckError[]): void {
  for (const err of errors) {
    console.error(
      `${ctx.chalk.cyan(err.file + ':' + err.line)}: ${ctx.chalk.red(err.message)}`,
    );
  }
  if (errors.length > 0) {
    console.error(
      ctx.chalk.red(
        `\n${errors.length} error${errors.length === 1 ? '' : 's'} found`,
      ),
    );
  }
}

function formatStats(ctx: CliContext, stats: FileStats): void {
  const entries = Object.entries(stats).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  const parts = entries.map(([ext, n]) => `${n} ${ext}`);
  console.log(ctx.chalk.dim(`Scanned ${parts.join(', ')}`));
}

export async function checkMdCmd(ctx: CliContext): Promise<void> {
  const { errors, files } = await checkMd(ctx.latDir);
  formatStats(ctx, files);
  formatErrors(ctx, errors);
  if (errors.length > 0) process.exit(1);
  console.log(ctx.chalk.green('md: All links OK'));
}

export async function checkCodeRefsCmd(ctx: CliContext): Promise<void> {
  const { errors, files } = await checkCodeRefs(ctx.latDir);
  formatStats(ctx, files);
  formatErrors(ctx, errors);
  if (errors.length > 0) process.exit(1);
  console.log(ctx.chalk.green('code-refs: All references OK'));
}

export async function checkAllCmd(ctx: CliContext): Promise<void> {
  const md = await checkMd(ctx.latDir);
  const code = await checkCodeRefs(ctx.latDir);
  const allErrors = [...md.errors, ...code.errors];
  const allFiles: FileStats = { ...md.files };
  for (const [ext, n] of Object.entries(code.files)) {
    allFiles[ext] = (allFiles[ext] || 0) + n;
  }

  formatStats(ctx, allFiles);
  formatErrors(ctx, allErrors);
  if (allErrors.length > 0) process.exit(1);
  console.log(ctx.chalk.green('All checks passed'));
}
