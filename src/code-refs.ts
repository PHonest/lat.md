import { readFile, readdir, access } from 'node:fs/promises';
import { join, relative } from 'node:path';

const IGNORE_DIRS = new Set([
  'node_modules',
  'dist',
  '.git',
  'lat.md',
  '.claude',
]);

export async function walkFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (IGNORE_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      // Skip sub-projects that have their own .lat directory
      try {
        await access(join(full, 'lat.md'));
        continue;
      } catch {
        // no .lat — descend normally
      }
      files.push(...(await walkFiles(full)));
    } else if (entry.isFile() && !entry.name.endsWith('.md')) {
      files.push(full);
    }
  }
  return files;
}

/** Build a RegExp from a verbose template — whitespace is insignificant. */
function re(flags: string) {
  return (strings: TemplateStringsArray) =>
    new RegExp(strings.raw[0].replace(/\s+/g, ''), flags);
}

// Line comment (// or #), then @lat: marker, then [[target]]
export const LAT_REF_RE = re('gv')`
  (?: // | # )
  \s* @lat: \s*
  \[\[
    ( [^\]]+ )
  \]\]
`;

export type CodeRef = {
  target: string;
  file: string;
  line: number;
};

export async function scanCodeRefs(projectRoot: string): Promise<CodeRef[]> {
  const files = await walkFiles(projectRoot);
  const refs: CodeRef[] = [];

  for (const file of files) {
    let content: string;
    try {
      content = await readFile(file, 'utf-8');
    } catch {
      continue;
    }
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      let match;
      LAT_REF_RE.lastIndex = 0;
      while ((match = LAT_REF_RE.exec(lines[i])) !== null) {
        refs.push({
          target: match[1],
          file: relative(process.cwd(), file),
          line: i + 1,
        });
      }
    }
  }

  return refs;
}
