import { execSync } from 'node:child_process';
import { dirname, extname } from 'node:path';
import { findLatticeDir } from '../lattice.js';
import { plainStyler, type CmdContext } from '../context.js';
import { expandPrompt } from './expand.js';
import { runSearch } from './search.js';
import { getSection, formatSectionOutput } from './section.js';
import { getLlmKey } from '../config.js';
import { checkMd, checkCodeRefs, checkIndex, checkSections } from './check.js';
import { SOURCE_EXTENSIONS } from '../source-parser.js';

function outputPromptSubmit(context: string): void {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: context,
      },
    }),
  );
}

function outputStop(reason: string): void {
  process.stdout.write(
    JSON.stringify({
      decision: 'block',
      reason,
    }),
  );
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

function hasWikiLinks(text: string): boolean {
  return /\[\[[^\]]+\]\]/.test(text);
}

function makeHookCtx(latDir: string): CmdContext {
  return {
    latDir,
    projectRoot: dirname(latDir),
    styler: plainStyler,
    mode: 'cli',
  };
}

async function searchAndExpand(
  ctx: CmdContext,
  userPrompt: string,
): Promise<string | null> {
  let key: string | undefined;
  try {
    key = getLlmKey();
  } catch {
    return null;
  }
  if (!key) return null;

  const result = await runSearch(ctx.latDir, userPrompt, key, 5);
  if (result.matches.length === 0) return null;

  const parts: string[] = [
    `Search results for the user prompt (${result.matches.length} matches):`,
    '',
  ];

  for (const match of result.matches) {
    const sectionResult = await getSection(ctx, match.section.id);
    if (sectionResult.kind === 'found') {
      parts.push(formatSectionOutput(ctx, sectionResult));
      parts.push('');
    }
  }

  return parts.join('\n');
}

async function handleUserPromptSubmit(): Promise<void> {
  let userPrompt = '';
  try {
    const raw = await readStdin();
    const input = JSON.parse(raw);
    userPrompt = input.user_prompt ?? '';
  } catch {
    // If we can't parse stdin, still emit the reminder
  }

  const parts: string[] = [];

  parts.push(
    "Before starting work, run `lat search` with one or more queries describing the user's intent.",
    'ALWAYS do this, even when the task seems straightforward — search results may reveal critical design details, protocols, or constraints.',
    'Use `lat section` to read the full content of relevant matches.',
    'Do not read files, write code, or run commands until you have searched.',
    '',
    'Remember: `lat.md/` must stay in sync with the codebase. If you change code, update the relevant sections in `lat.md/` and run `lat check` before finishing.',
  );

  const latDir = findLatticeDir();
  if (latDir && userPrompt) {
    const ctx = makeHookCtx(latDir);

    // If the user prompt contains [[refs]], resolve them inline
    if (hasWikiLinks(userPrompt)) {
      try {
        const expanded = await expandPrompt(ctx, userPrompt);
        if (expanded) {
          parts.push(
            '',
            'Expanded user prompt with resolved [[refs]]:',
            expanded,
          );
        } else {
          parts.push(
            '',
            'NOTE: The user prompt contains [[refs]] but they could not be resolved. Ask the user to correct them.',
          );
        }
      } catch {
        parts.push(
          '',
          'NOTE: The user prompt contains [[refs]] but resolution failed. Run `lat expand` on the prompt text manually.',
        );
      }
    }

    // Search for relevant sections and include their full content
    try {
      const searchContext = await searchAndExpand(ctx, userPrompt);
      if (searchContext) {
        parts.push('', searchContext);
      }
    } catch {
      // Search failed (no key, index error, etc.) — agent can search manually
    }
  }

  outputPromptSubmit(parts.join('\n'));
}

/** Minimum diff size (in lines) to consider "significant" code change. */
/** Minimum code change size (lines) before we consider flagging lat.md/ sync. */
const DIFF_THRESHOLD = 5;

/** lat.md/ changes below this ratio of code changes trigger a sync reminder. */
const LATMD_RATIO = 0.05;

/** If lat.md/ changes exceed this many lines, skip the ratio check entirely. */
const LATMD_UPPER_THRESHOLD = 50;

/** Run `git diff --numstat` and return { codeLines, latMdLines }. */
function analyzeDiff(projectRoot: string): {
  codeLines: number;
  latMdLines: number;
} {
  let output: string;
  try {
    output = execSync('git diff HEAD --numstat', {
      cwd: projectRoot,
      encoding: 'utf-8',
    });
  } catch {
    return { codeLines: 0, latMdLines: 0 };
  }

  let codeLines = 0;
  let latMdLines = 0;

  // Each line: "added\tremoved\tfile" (e.g. "42\t11\tsrc/cli/hook.ts")
  for (const line of output.split('\n')) {
    const parts = line.split('\t');
    if (parts.length < 3) continue;
    const added = parseInt(parts[0], 10) || 0;
    const removed = parseInt(parts[1], 10) || 0;
    const file = parts[2];
    const changed = added + removed;
    if (file.startsWith('lat.md/')) {
      latMdLines += changed;
    } else if (SOURCE_EXTENSIONS.has(extname(file))) {
      codeLines += changed;
    }
  }

  return { codeLines, latMdLines };
}

async function handleStop(): Promise<void> {
  const latDir = findLatticeDir();
  if (!latDir) return;

  // Read stdin to check if we already blocked once
  let stopHookActive = false;
  try {
    const raw = await readStdin();
    const input = JSON.parse(raw);
    stopHookActive = input.stop_hook_active ?? false;
  } catch {
    // If we can't parse stdin, treat as first attempt
  }

  // Always run lat check — even on second pass
  const md = await checkMd(latDir);
  const code = await checkCodeRefs(latDir);
  const indexErrors = await checkIndex(latDir);
  const sectionErrors = await checkSections(latDir);
  const totalErrors =
    md.errors.length +
    code.errors.length +
    indexErrors.length +
    sectionErrors.length;
  const checkFailed = totalErrors > 0;

  // Second pass — warn the user but don't block again
  if (stopHookActive) {
    if (checkFailed) {
      console.error(
        `lat check is still failing (${totalErrors} error(s)). Run \`lat check\` to see details.`,
      );
    }
    return;
  }

  const projectRoot = dirname(latDir);

  // Analyze git diff — flag when lat.md/ changes are < 5% of code changes
  const { codeLines, latMdLines } = analyzeDiff(projectRoot);
  let needsSync = false;
  if (codeLines >= DIFF_THRESHOLD && latMdLines < LATMD_UPPER_THRESHOLD) {
    // Round up lat.md lines to 1 if nonzero (a tiny touch still counts)
    const effectiveLatMd = latMdLines === 0 ? 0 : Math.max(latMdLines, 1);
    needsSync = effectiveLatMd < codeLines * LATMD_RATIO;
  }

  // Nothing to do — let the agent stop cleanly
  if (!checkFailed && !needsSync) return;

  const parts: string[] = [];

  const syncMsg =
    latMdLines === 0
      ? 'The codebase has changes (' +
        codeLines +
        ' lines) but `lat.md/` was not updated.'
      : 'The codebase has changes (' +
        codeLines +
        ' lines) but `lat.md/` may not be fully in sync (' +
        latMdLines +
        ' lines changed).';

  if (checkFailed && needsSync) {
    parts.push(
      '`lat check` found errors. ' + syncMsg + ' Before finishing:',
      '',
      '1. Update `lat.md/` to reflect your code changes — run `lat search` to find relevant sections.',
      '2. Run `lat check` until it passes.',
    );
  } else if (checkFailed) {
    parts.push(
      '`lat check` found ' +
        totalErrors +
        ' error(s). Run `lat check`, fix the errors, and repeat until it passes.',
    );
  } else {
    parts.push(
      syncMsg +
        ' Verify `lat.md/` is in sync — run `lat search` to find relevant sections. Run `lat check` at the end.',
    );
  }

  outputStop(parts.join('\n'));
}

export async function hookCmd(agent: string, event: string): Promise<void> {
  if (agent !== 'claude') {
    console.error(`Unknown agent: ${agent}. Supported: claude`);
    process.exit(1);
  }

  switch (event) {
    case 'UserPromptSubmit':
      await handleUserPromptSubmit();
      break;
    case 'Stop':
      await handleStop();
      break;
    default:
      console.error(
        `Unknown hook event: ${event}. Supported: UserPromptSubmit, Stop`,
      );
      process.exit(1);
  }
}
