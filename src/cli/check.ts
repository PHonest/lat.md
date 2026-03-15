import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, dirname, extname, join, relative } from 'node:path';
import {
  listLatticeFiles,
  loadAllSections,
  extractRefs,
  flattenSections,
  parseFrontmatter,
  parseSections,
  buildFileIndex,
  resolveRef,
  type Section,
} from '../lattice.js';
import { scanCodeRefs } from '../code-refs.js';
import { walkEntries } from '../walk.js';
import type { CliContext } from './context.js';

export type CheckError = {
  file: string;
  line: number;
  target: string;
  message: string;
};

function filePart(id: string): string {
  const h = id.indexOf('#');
  return h === -1 ? id : id.slice(0, h);
}

/** Format an ambiguous-ref error as structured markdown-like text. */
function ambiguousMessage(
  target: string,
  candidates: string[],
  suggested: string | null,
): string {
  const shortName = filePart(target);
  const fileList = candidates.map((c) => `  - "${filePart(c)}.md"`).join('\n');
  const lines: string[] = [];

  if (suggested) {
    lines.push(
      `ambiguous link '[[${target}]]' — did you mean '[[${suggested}]]'?`,
    );
  } else {
    const options = candidates.map((a) => `'[[${a}]]'`).join(', ');
    lines.push(
      `ambiguous link '[[${target}]]' — multiple paths match, use either of: ${options}`,
    );
  }

  lines.push(
    `  The short path "${shortName}" is ambiguous — ${candidates.length} files match:`,
    fileList,
    `  Please fix the link to use a fully qualified path.`,
  );
  return lines.join('\n');
}

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

/** Source file extensions recognized for code wiki links. */
const SOURCE_EXTS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.py',
  '.rs',
  '.go',
  '.c',
  '.h',
]);

function isSourcePath(target: string): boolean {
  const hashIdx = target.indexOf('#');
  const filePart = hashIdx === -1 ? target : target.slice(0, hashIdx);
  const ext = extname(filePart);
  return SOURCE_EXTS.has(ext);
}

/**
 * Try resolving a wiki link target as a source code reference.
 * Returns null if the reference is valid, or an error message string.
 */
async function tryResolveSourceRef(
  target: string,
  projectRoot: string,
): Promise<string | null> {
  if (!isSourcePath(target)) {
    return `broken link [[${target}]] — no matching section found`;
  }

  const hashIdx = target.indexOf('#');
  const filePart = hashIdx === -1 ? target : target.slice(0, hashIdx);
  const symbolPart = hashIdx === -1 ? '' : target.slice(hashIdx + 1);

  const absPath = join(projectRoot, filePart);
  if (!existsSync(absPath)) {
    return `broken link [[${target}]] — file "${filePart}" not found`;
  }

  if (!symbolPart) {
    // File-only link with no symbol — valid as long as file exists
    return null;
  }

  try {
    const { resolveSourceSymbol } = await import('../source-parser.js');
    const { found, error } = await resolveSourceSymbol(
      filePart,
      symbolPart,
      projectRoot,
    );
    if (error) {
      return `broken link [[${target}]] — ${error}`;
    }
    if (!found) {
      return `broken link [[${target}]] — symbol "${symbolPart}" not found in "${filePart}"`;
    }
    return null;
  } catch (err) {
    return `broken link [[${target}]] — failed to parse "${filePart}": ${err instanceof Error ? err.message : String(err)}`;
  }
}

export async function checkMd(latticeDir: string): Promise<CheckResult> {
  const projectRoot = dirname(latticeDir);
  const files = await listLatticeFiles(latticeDir);
  const allSections = await loadAllSections(latticeDir);
  const flat = flattenSections(allSections);
  const sectionIds = new Set(flat.map((s) => s.id.toLowerCase()));
  const fileIndex = buildFileIndex(allSections);

  const errors: CheckError[] = [];

  for (const file of files) {
    const content = await readFile(file, 'utf-8');
    const refs = extractRefs(file, content, projectRoot);
    const relPath = relative(process.cwd(), file);

    for (const ref of refs) {
      const { resolved, ambiguous, suggested } = resolveRef(
        ref.target,
        sectionIds,
        fileIndex,
      );
      if (ambiguous) {
        errors.push({
          file: relPath,
          line: ref.line,
          target: ref.target,
          message: ambiguousMessage(ref.target, ambiguous, suggested),
        });
      } else if (!sectionIds.has(resolved.toLowerCase())) {
        // Try resolving as a source code reference (e.g. [[src/foo.ts#bar]])
        const sourceErr = await tryResolveSourceRef(ref.target, projectRoot);
        if (sourceErr !== null) {
          errors.push({
            file: relPath,
            line: ref.line,
            target: ref.target,
            message: sourceErr,
          });
        }
      }
    }
  }

  return { errors, files: countByExt(files) };
}

export async function checkCodeRefs(latticeDir: string): Promise<CheckResult> {
  const projectRoot = dirname(latticeDir);
  const allSections = await loadAllSections(latticeDir);
  const flat = flattenSections(allSections);
  const sectionIds = new Set(flat.map((s) => s.id.toLowerCase()));
  const fileIndex = buildFileIndex(allSections);

  const scan = await scanCodeRefs(projectRoot);
  const errors: CheckError[] = [];

  const mentionedSections = new Set<string>();
  for (const ref of scan.refs) {
    const { resolved, ambiguous, suggested } = resolveRef(
      ref.target,
      sectionIds,
      fileIndex,
    );
    mentionedSections.add(resolved.toLowerCase());
    if (ambiguous) {
      errors.push({
        file: ref.file,
        line: ref.line,
        target: ref.target,
        message: ambiguousMessage(ref.target, ambiguous, suggested),
      });
    } else if (!sectionIds.has(resolved.toLowerCase())) {
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

    const sections = parseSections(file, content, projectRoot);
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

/**
 * Extract the immediate (first-level) entries from walkEntries results.
 * Returns unique file and directory names visible in a given directory.
 */
function immediateEntries(walkedPaths: string[]): string[] {
  const entries = new Set<string>();
  for (const p of walkedPaths) {
    const slash = p.indexOf('/');
    entries.add(slash === -1 ? p : p.slice(0, slash));
  }
  return [...entries].sort();
}

/** Parse bullet items from an index file. Matches `- [[name]] — description` */
function parseIndexEntries(content: string): Set<string> {
  const names = new Set<string>();
  const re = /^- \[\[([^\]]+?)(?:\|[^\]]+)?\]\]/gm;
  let match;
  while ((match = re.exec(content)) !== null) {
    names.add(match[1]);
  }
  return names;
}

/**
 * Convert a filesystem entry name to its wiki link stem.
 * Strips `.md` extension from files; directories stay as-is.
 */
function entryToStem(name: string): string {
  return name.endsWith('.md') ? name.slice(0, -3) : name;
}

/** Generate a bullet-list snippet for the given entry names. */
function indexSnippet(entries: string[]): string {
  return entries.map((e) => `- [[${entryToStem(e)}]] — <describe>`).join('\n');
}

export type IndexError = {
  dir: string;
  message: string;
  snippet?: string;
};

export async function checkIndex(latticeDir: string): Promise<IndexError[]> {
  const errors: IndexError[] = [];
  const allPaths = await walkEntries(latticeDir);

  // Collect all directories to check (including root, represented as '')
  const dirs = new Set<string>(['']);
  for (const p of allPaths) {
    const parts = p.split('/');
    // Add every directory prefix
    for (let i = 1; i < parts.length; i++) {
      dirs.add(parts.slice(0, i).join('/'));
    }
  }

  for (const dir of dirs) {
    // Determine the index file name and its expected path.
    // The index file shares the directory's name — for `lat.md/` it's `lat.md`,
    // for a subdir `api/` it's `api.md`.
    const dirName = dir === '' ? basename(latticeDir) : dir.split('/').pop()!;
    const indexFileName = dirName.endsWith('.md') ? dirName : dirName + '.md';
    const indexRelPath = dir === '' ? indexFileName : dir + '/' + indexFileName;

    // Get the immediate children of this directory
    const prefix = dir === '' ? '' : dir + '/';
    const childPaths = allPaths
      .filter((p) => p.startsWith(prefix) && p !== indexRelPath)
      .map((p) => p.slice(prefix.length));
    const children = immediateEntries(childPaths);

    if (children.length === 0) continue;

    // Check if the index file exists
    const indexFullPath = join(latticeDir, indexRelPath);
    let content: string;
    try {
      content = await readFile(indexFullPath, 'utf-8');
    } catch {
      const relDir = dir === '' ? basename(latticeDir) + '/' : dir + '/';
      errors.push({
        dir: relDir,
        message: `missing index file "${indexRelPath}" — create it with a directory listing:\n\n${indexSnippet(children)}`,
        snippet: indexSnippet(children),
      });
      continue;
    }

    // Parse existing entries and validate.
    // Listed entries are wiki link stems (no .md extension).
    // Children are filesystem names (with .md for files, bare for dirs).
    const listed = parseIndexEntries(content);
    const childStems = new Set(children.map(entryToStem));
    const stemToChild = new Map(children.map((c) => [entryToStem(c), c]));
    const relDir = dir === '' ? basename(latticeDir) + '/' : dir + '/';
    const missing: string[] = [];

    for (const child of children) {
      if (!listed.has(entryToStem(child))) {
        missing.push(child);
      }
    }

    if (missing.length > 0) {
      errors.push({
        dir: relDir,
        message: `"${indexRelPath}" is missing entries — add:\n\n${indexSnippet(missing)}`,
        snippet: indexSnippet(missing),
      });
    }

    const indexStem = entryToStem(indexFileName);
    for (const name of listed) {
      if (!childStems.has(name) && name !== indexStem) {
        errors.push({
          dir: relDir,
          message: `"${indexRelPath}" lists "[[${name}]]" but it does not exist`,
        });
      }
    }
  }

  return errors;
}

function formatErrors(
  ctx: CliContext,
  errors: CheckError[],
  startIdx = 0,
): void {
  for (let i = 0; i < errors.length; i++) {
    const err = errors[i];
    if (i > 0 || startIdx > 0) console.error('');
    const loc = ctx.chalk.cyan(err.file + ':' + err.line);
    const [first, ...rest] = err.message.split('\n');
    console.error(`- ${loc}: ${ctx.chalk.red(first)}`);
    for (const line of rest) {
      console.error(`  ${ctx.chalk.red(line)}`);
    }
  }
}

function formatIndexErrors(
  ctx: CliContext,
  errors: IndexError[],
  startIdx = 0,
): void {
  for (let i = 0; i < errors.length; i++) {
    if (i > 0 || startIdx > 0) console.error('');
    const loc = ctx.chalk.cyan(errors[i].dir);
    const [first, ...rest] = errors[i].message.split('\n');
    console.error(`- ${loc}: ${ctx.chalk.red(first)}`);
    for (const line of rest) {
      console.error(`  ${ctx.chalk.red(line)}`);
    }
  }
}

function formatErrorCount(ctx: CliContext, count: number): void {
  if (count > 0) {
    console.error(
      ctx.chalk.red(`\n${count} error${count === 1 ? '' : 's'} found`),
    );
  }
}

function formatStats(ctx: CliContext, stats: FileStats): void {
  const entries = Object.entries(stats).sort(([a], [b]) => a.localeCompare(b));
  const parts = entries.map(([ext, n]) => `${n} ${ext}`);
  console.log(ctx.chalk.dim(`Scanned ${parts.join(', ')}`));
}

export async function checkMdCmd(ctx: CliContext): Promise<void> {
  const { errors, files } = await checkMd(ctx.latDir);
  formatStats(ctx, files);
  formatErrors(ctx, errors);
  formatErrorCount(ctx, errors.length);
  if (errors.length > 0) process.exit(1);
  console.log(ctx.chalk.green('md: All links OK'));
}

export async function checkCodeRefsCmd(ctx: CliContext): Promise<void> {
  const { errors, files } = await checkCodeRefs(ctx.latDir);
  formatStats(ctx, files);
  formatErrors(ctx, errors);
  formatErrorCount(ctx, errors.length);
  if (errors.length > 0) process.exit(1);
  console.log(ctx.chalk.green('code-refs: All references OK'));
}

export async function checkIndexCmd(ctx: CliContext): Promise<void> {
  const errors = await checkIndex(ctx.latDir);
  formatIndexErrors(ctx, errors);
  formatErrorCount(ctx, errors.length);
  if (errors.length > 0) process.exit(1);
  console.log(ctx.chalk.green('index: All directory index files OK'));
}

export async function checkAllCmd(ctx: CliContext): Promise<void> {
  const md = await checkMd(ctx.latDir);
  const code = await checkCodeRefs(ctx.latDir);
  const indexErrors = await checkIndex(ctx.latDir);

  const allErrors = [...md.errors, ...code.errors];
  const allFiles: FileStats = { ...md.files };
  for (const [ext, n] of Object.entries(code.files)) {
    allFiles[ext] = (allFiles[ext] || 0) + n;
  }

  formatStats(ctx, allFiles);
  formatErrors(ctx, allErrors);
  formatIndexErrors(ctx, indexErrors, allErrors.length);

  const totalErrors = allErrors.length + indexErrors.length;
  formatErrorCount(ctx, totalErrors);
  if (totalErrors > 0) process.exit(1);
  console.log(ctx.chalk.green('All checks passed'));

  const { getLlmKey } = await import('../config.js');
  let hasKey = false;
  try {
    hasKey = !!getLlmKey();
  } catch {
    // key resolution failed (e.g. empty file) — treat as missing
  }
  if (!hasKey) {
    console.log(
      ctx.chalk.yellow('Warning:') +
        ' No LLM key found — semantic search (lat search) will not work.' +
        ' Provide a key via LAT_LLM_KEY, LAT_LLM_KEY_FILE, LAT_LLM_KEY_HELPER, or run ' +
        ctx.chalk.cyan('lat init') +
        ' to configure.',
    );
  }
}
