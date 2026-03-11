import { resolve } from 'node:path';
// @ts-expect-error -- no type declarations
import walk from 'ignore-walk';

const cache = new Map<string, Promise<string[]>>();

/**
 * Walk a directory tree respecting .gitignore rules. Returns relative paths
 * of all non-ignored files, excluding .git/ and dotfiles (e.g. .gitignore).
 *
 * Results are memoized by resolved directory path — safe because CLI commands
 * don't modify the filesystem during a run. Set _LAT_TEST_DISABLE_FS_CACHE=1
 * to bypass caching in tests that mutate the filesystem mid-run.
 *
 * This is the single entry point for all directory walking in lat.md — both
 * code-ref scanning and lat.md/ index validation use it so .gitignore rules
 * are consistently honored.
 */
export function walkEntries(dir: string): Promise<string[]> {
  const noCache = !!process.env._LAT_TEST_DISABLE_FS_CACHE;
  if (!noCache) {
    const cached = cache.get(resolve(dir));
    if (cached) return cached;
  }
  const result = walk({
    path: dir,
    ignoreFiles: ['.gitignore'],
  }).then((entries: string[]) =>
    entries.filter((e: string) => !e.startsWith('.git/') && !e.startsWith('.')),
  );
  if (!noCache) {
    cache.set(resolve(dir), result);
  }
  return result;
}
