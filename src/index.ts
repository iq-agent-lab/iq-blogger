/**
 * iq-blogger — CLI Entrypoint
 *
 * Commands:
 *   convert <source-file.md>   → produce MDX, print to stdout or write to disk.
 *   validate <file.mdx>        → check constraints, print report, exit 0/1.
 *
 * Environment:
 *   ANTHROPIC_API_KEY    — required for convert
 *   IQ_BLOGGER_MODEL     — optional, defaults to claude-sonnet-4-6
 *   IQ_BLOGGER_MAX_RETRIES — optional, defaults to 3
 *   IQ_BLOGGER_DEBUG     — set to 1 for verbose logs
 *
 * Usage examples:
 *
 *   # Convert one chapter, write to stdout
 *   tsx src/index.ts convert \
 *     --source iq-dev-lab/redis-deep-dive \
 *     --path redis-internals/01-single-thread-event-loop.md \
 *     --order 1 \
 *     --title "Redis Internals" \
 *     ./redis-deep-dive/redis-internals/01-single-thread-event-loop.md
 *
 *   # Validate an existing MDX file
 *   tsx src/index.ts validate ./draft.mdx
 *
 *   # With output directory (writes <slug>.mdx inside)
 *   tsx src/index.ts convert --out ./drafts ... <source.md>
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, basename } from 'node:path';
import { config as loadEnv } from 'dotenv';
import { convert } from './agent';
import { validate, parseMdx } from './validator';
import type { ConversionInput, ValidationResult } from './types';
import { loadProgress, formatStatusReport } from './progress';

// Load .env from CWD, falling back to package root.
loadEnv();

/* ─────────────────────────────────────────────────────────────
   CLI arg parsing — lightweight, no dependency.
   Supports `--flag value` and `--flag=value`.
   ───────────────────────────────────────────────────────────── */

interface Args {
  command: string;
  positional: string[];
  flags: Record<string, string>;
}

function parseArgs(argv: string[]): Args {
  const args = argv.slice(2); // skip node + script path
  const command = args[0] ?? '';
  const rest = args.slice(1);

  const positional: string[] = [];
  const flags: Record<string, string> = {};

  for (let i = 0; i < rest.length; i++) {
    const token = rest[i];
    if (token === undefined) continue;

    if (token.startsWith('--')) {
      // --flag=value
      const eqIdx = token.indexOf('=');
      if (eqIdx !== -1) {
        const key = token.slice(2, eqIdx);
        const val = token.slice(eqIdx + 1);
        flags[key] = val;
      } else {
        // --flag value
        const key = token.slice(2);
        const next = rest[i + 1];
        if (next !== undefined && !next.startsWith('--')) {
          flags[key] = next;
          i++;
        } else {
          flags[key] = 'true';
        }
      }
    } else {
      positional.push(token);
    }
  }

  return { command, positional, flags };
}

/* ─────────────────────────────────────────────────────────────
   Command: convert
   ───────────────────────────────────────────────────────────── */

async function cmdConvert(args: Args): Promise<number> {
  const sourceFile = args.positional[0];
  if (!sourceFile) {
    console.error('Error: convert requires a source .md file path.');
    console.error('');
    printConvertHelp();
    return 2;
  }

  // Required flags.
  const requiredFlags = ['source', 'path', 'order', 'title'] as const;
  const missing = requiredFlags.filter((f) => !args.flags[f]);
  if (missing.length > 0) {
    console.error(`Error: missing required flags: ${missing.map((f) => `--${f}`).join(', ')}`);
    console.error('');
    printConvertHelp();
    return 2;
  }

  const order = Number(args.flags.order);
  if (!Number.isInteger(order) || order < 1) {
    console.error(`Error: --order must be a positive integer, got "${args.flags.order}"`);
    return 2;
  }

  // Read source document.
  let content: string;
  try {
    content = await readFile(sourceFile, 'utf-8');
  } catch (err) {
    console.error(`Error: cannot read source file "${sourceFile}": ${(err as Error).message}`);
    return 1;
  }

  // Build ConversionInput.
  const runDate = args.flags.date ?? today();
  const input: ConversionInput = {
    sourceRepo: args.flags.source!,
    sourcePath: args.flags.path!,
    chapterOrder: order,
    chapterTitle: args.flags.title!,
    runDate,
    content,
  };

  // Run conversion.
  console.error(`[iq-blogger] Converting ${input.sourcePath} (order=${input.chapterOrder})...`);
  const result = await convert(input);

  if (!result.ok) {
    console.error('');
    console.error(`[iq-blogger] FAILED after ${result.history.length} attempts: ${result.reason}`);
    console.error('');
    console.error('Last validation issues:');
    for (const issue of result.issues) {
      console.error(`  - [${issue.severity}] [${issue.rule}] ${issue.message}`);
    }
    return 1;
  }

  // Success. Decide where to write.
  const outDir = args.flags.out;
  if (outDir) {
    await mkdir(outDir, { recursive: true });
    const outPath = resolve(outDir, `${result.slug}.mdx`);
    await writeFile(outPath, result.mdx, 'utf-8');
    console.error('');
    console.error(`[iq-blogger] Wrote ${outPath}`);
    console.error(`[iq-blogger] Attempts: ${result.history.length} | Tokens: in=${result.usage.inputTokens}, out=${result.usage.outputTokens} | Cost: $${result.usage.estimatedCostUsd.toFixed(4)}`);
    console.error(`[iq-blogger] Metrics: ${JSON.stringify(result.history.at(-1)?.validation.metrics)}`);
  } else {
    // Stdout — useful for piping.
    process.stdout.write(result.mdx);
    console.error('');
    console.error(`[iq-blogger] ${result.slug}.mdx | attempts=${result.history.length} | cost=$${result.usage.estimatedCostUsd.toFixed(4)}`);
  }

  return 0;
}

function printConvertHelp(): void {
  console.error(
    [
      'Usage: tsx src/index.ts convert [options] <source-file.md>',
      '',
      'Required flags:',
      '  --source <owner/repo>       GitHub repo, e.g. iq-dev-lab/redis-deep-dive',
      '  --path <path>               Path within repo, e.g. redis-internals/01-xyz.md',
      '  --order <int>               Chapter order in series (1-based)',
      '  --title <string>            Human-readable series title',
      '',
      'Optional flags:',
      '  --date <YYYY-MM-DD>         Override pubDate (default: today)',
      '  --out <dir>                 Write <slug>.mdx to this dir (default: stdout)',
      '',
      'Example:',
      '  tsx src/index.ts convert \\',
      '    --source iq-dev-lab/redis-deep-dive \\',
      '    --path redis-internals/01-single-thread-event-loop.md \\',
      '    --order 1 \\',
      '    --title "Redis Internals" \\',
      '    --out ./drafts \\',
      '    ./redis-deep-dive/redis-internals/01-single-thread-event-loop.md',
    ].join('\n'),
  );
}

/* ─────────────────────────────────────────────────────────────
   Command: validate
   ───────────────────────────────────────────────────────────── */

async function cmdValidate(args: Args): Promise<number> {
  const file = args.positional[0];
  if (!file) {
    console.error('Error: validate requires an MDX file path.');
    console.error('Usage: tsx src/index.ts validate <file.mdx>');
    return 2;
  }

  let content: string;
  try {
    content = await readFile(file, 'utf-8');
  } catch (err) {
    console.error(`Error: cannot read file "${file}": ${(err as Error).message}`);
    return 1;
  }

  const result = validate(content);
  printValidationReport(basename(file), result);

  return result.ok ? 0 : 1;
}

function printValidationReport(filename: string, result: ValidationResult): void {
  const status = result.ok ? '✅ PASS' : '❌ FAIL';
  console.log(`${status}  ${filename}`);
  console.log('');
  console.log('Metrics:');
  console.log(`  word count:   ${result.metrics.wordCount}`);
  console.log(`  H2 sections:  ${result.metrics.h2Count}`);
  console.log(`  code blocks:  ${result.metrics.codeBlockCount}`);
  console.log(`  math blocks:  ${result.metrics.mathBlockCount}`);
  console.log(`  MDX components: ${result.metrics.mdxComponentCount}`);

  if (result.issues.length === 0) {
    console.log('');
    console.log('No issues.');
    return;
  }

  const errors = result.issues.filter((i) => i.severity === 'error');
  const warnings = result.issues.filter((i) => i.severity === 'warning');

  if (errors.length > 0) {
    console.log('');
    console.log(`Errors (${errors.length}):`);
    for (const issue of errors) {
      console.log(`  ✗ [${issue.rule}] ${issue.message}`);
    }
  }

  if (warnings.length > 0) {
    console.log('');
    console.log(`Warnings (${warnings.length}):`);
    for (const issue of warnings) {
      console.log(`  ! [${issue.rule}] ${issue.message}`);
    }
  }
}

/* ─────────────────────────────────────────────────────────────
   Utility
   ───────────────────────────────────────────────────────────── */

function today(): string {
  // YYYY-MM-DD in the system's local timezone.
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function printRootHelp(): void {
  console.log(
      [
        'iq-blogger — Convert deep-dive docs into IQ Lab Blog posts.',
        '',
        'Commands:',
        '  convert   Convert a .md deep-dive to .mdx blog post',
        '  validate  Check an existing .mdx against blog hard constraints',
        '  status    Show conversion progress across repos and folders',
        '',
        'Run `tsx src/index.ts <command> --help` for command-specific options.',
      ].join('\n'),
  );
}

/* ─────────────────────────────────────────────────────────────
   Entry
   ───────────────────────────────────────────────────────────── */

async function main(): Promise<void> {
  const args = parseArgs(process.argv);

  if (!args.command || args.command === '--help' || args.command === '-h') {
    printRootHelp();
    process.exit(0);
  }

  let code: number;
  try {
    switch (args.command) {
      case 'convert':
        code = await cmdConvert(args);
        break;
      case 'validate':
        code = await cmdValidate(args);
        break;
      case 'status':
        code = await cmdStatus(args);
        break;
      default:
        console.error(`Unknown command: "${args.command}"`);
        console.error('');
        printRootHelp();
        code = 2;
    }
  } catch (err) {
    console.error(`[iq-blogger] Unhandled error: ${(err as Error).message}`);
    if (process.env.IQ_BLOGGER_DEBUG === '1') {
      console.error((err as Error).stack);
    }
    code = 1;
  }

  process.exit(code);
}

/* ─────────────────────────────────────────────────────────────
   Command: status
   ───────────────────────────────────────────────────────────── */

async function cmdStatus(args: Args): Promise<number> {
  // Default progress location: drafts/progress.json
  const progressPath = args.flags.file ?? './drafts/progress.json';

  const progress = await loadProgress(progressPath);
  const report = formatStatusReport(progress);
  console.log(report);

  return 0;
}

main();
