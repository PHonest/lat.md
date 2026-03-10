import {
  existsSync,
  cpSync,
  mkdirSync,
  writeFileSync,
  symlinkSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import chalk from 'chalk';
import { findTemplatesDir } from './templates.js';
import { readAgentsTemplate } from './gen.js';

async function confirm(
  rl: ReturnType<typeof createInterface>,
  message: string,
): Promise<boolean> {
  try {
    const answer = await rl.question(`${message} ${chalk.dim('[Y/n]')} `);
    return answer.trim().toLowerCase() !== 'n';
  } catch {
    return true;
  }
}

export async function initCmd(targetDir?: string): Promise<void> {
  const root = resolve(targetDir ?? process.cwd());
  const latDir = join(root, 'lat.md');

  const interactive = process.stdin.isTTY ?? false;
  const rl = interactive
    ? createInterface({ input: process.stdin, output: process.stdout })
    : null;

  const ask = async (message: string): Promise<boolean> => {
    if (!rl) return true;
    return confirm(rl, message);
  };

  try {
    // Step 1: lat.md/ directory
    if (existsSync(latDir)) {
      console.log(chalk.green('lat.md/') + ' already exists');
    } else {
      if (!(await ask('Create lat.md/ directory?'))) {
        console.log('Aborted.');
        return;
      }
      const templateDir = join(findTemplatesDir(), 'init');
      mkdirSync(latDir, { recursive: true });
      cpSync(templateDir, latDir, { recursive: true });
      console.log(chalk.green('Created lat.md/'));
    }

    // Step 2: AGENTS.md / CLAUDE.md
    const agentsPath = join(root, 'AGENTS.md');
    const claudePath = join(root, 'CLAUDE.md');
    const hasAgents = existsSync(agentsPath);
    const hasClaude = existsSync(claudePath);

    if (!hasAgents && !hasClaude) {
      if (
        await ask(
          'Generate AGENTS.md and CLAUDE.md with lat.md instructions for coding agents?',
        )
      ) {
        const template = readAgentsTemplate();
        writeFileSync(agentsPath, template);
        symlinkSync('AGENTS.md', claudePath);
        console.log(chalk.green('Created AGENTS.md and CLAUDE.md → AGENTS.md'));
      }
    } else {
      const existing = [hasAgents && 'AGENTS.md', hasClaude && 'CLAUDE.md']
        .filter(Boolean)
        .join(' and ');
      console.log(
        `\n${existing} already exists. Run ${chalk.cyan('lat gen agents.md')} to preview the template,` +
          ` then incorporate its content or overwrite as needed.`,
      );
    }
  } finally {
    rl?.close();
  }
}
