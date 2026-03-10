import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findTemplatesDir } from './templates.js';

export function readAgentsTemplate(): string {
  return readFileSync(join(findTemplatesDir(), 'AGENTS.md'), 'utf-8');
}

export async function genCmd(target: string): Promise<void> {
  const normalized = target.toLowerCase();
  if (normalized !== 'agents.md' && normalized !== 'claude.md') {
    console.error(`Unknown target: ${target}. Supported: agents.md, claude.md`);
    process.exit(1);
  }

  process.stdout.write(readAgentsTemplate());
}
