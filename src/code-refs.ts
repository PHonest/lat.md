import { readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
// @ts-expect-error -- no type declarations
import walk from 'ignore-walk';

/** Walk project files respecting .gitignore. Skips lat.md/, .claude/, and sub-projects. */
export async function walkFiles(dir: string): Promise<string[]> {
  const entries: string[] = await walk({
    path: dir,
    ignoreFiles: ['.gitignore'],
  });

  // Collect directories that contain their own lat.md/ (sub-projects)
  const subProjects = new Set<string>();
  for (const e of entries) {
    const i = e.indexOf('/lat.md/');
    if (i !== -1) subProjects.add(e.slice(0, i + 1));
  }

  return entries
    .filter(
      (e) =>
        !e.endsWith('.md') &&
        !e.startsWith('.git/') &&
        !e.startsWith('lat.md/') &&
        !e.startsWith('.claude/') &&
        ![...subProjects].some((prefix) => e.startsWith(prefix)),
    )
    .map((e) => join(dir, e));
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

export type ScanResult = {
  refs: CodeRef[];
  files: string[];
};

export async function scanCodeRefs(
  projectRoot: string,
): Promise<ScanResult> {
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

  return { refs, files };
}
