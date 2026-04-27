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
import { convertFolder } from './folder-converter';
import { cloneOrPull } from './git-ops';
import { convertRepo } from './repo-converter';
import { deploy, revert } from './publisher';

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
        '  convert         Convert a single .md file to .mdx blog post (translation)',
        '  convert-folder  Synthesize a folder of chapters into one .mdx (synthesis)',
        '  convert-repo    Clone a repo and convert all folders (full automation)',
        '  validate        Check an existing .mdx against blog hard constraints',
        '  status          Show conversion progress across repos and folders',
        '  clone           Clone or update a source repo (testing)',
        '  deploy          Deploy generated posts to blog (copy + commit + push)',
        '  revert          Revert published posts (remove + commit + push)',
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
      case 'convert-folder':
        code = await cmdConvertFolder(args);
        break;
      case 'validate':
        code = await cmdValidate(args);
        break;
      case 'status':
        code = await cmdStatus(args);
        break;
      case 'clone':
        code = await cmdClone(args);
        break;
      case 'convert-repo':
        code = await cmdConvertRepo(args);
        break;
      case 'deploy':
        code = await cmdDeploy(args);
        break;
      case 'revert':
        code = await cmdRevert(args);
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

/* ─────────────────────────────────────────────────────────────
   Command: convert-folder
   ───────────────────────────────────────────────────────────── */

async function cmdConvertFolder(args: Args): Promise<number> {
  const folderPath = args.positional[0];
  if (!folderPath) {
    console.error('Error: convert-folder requires a folder path.');
    console.error('');
    printConvertFolderHelp();
    return 2;
  }

  // Required flags
  const requiredFlags = ['source', 'folder', 'title'] as const;
  const missing = requiredFlags.filter((f) => !args.flags[f]);
  if (missing.length > 0) {
    console.error(`Error: missing required flags: ${missing.map((f) => `--${f}`).join(', ')}`);
    console.error('');
    printConvertFolderHelp();
    return 2;
  }

  const result = await convertFolder({
    source: args.flags.source!,
    folder: args.flags.folder!,
    title: args.flags.title!,
    folderPath,
    outDir: args.flags.out,
    date: args.flags.date,
    skipIfDone: args.flags.force !== 'true',
  });

  if (!result.ok) {
    console.error(`[iq-blogger] FAILED: ${result.reason}`);
    if (result.issues) {
      console.error('Issues:');
      for (const issue of result.issues) {
        console.error(`  - ${issue}`);
      }
    }
    return 1;
  }

  console.error('');
  console.error(`[iq-blogger] ✅ Synthesized ${result.chaptersUsed} chapters → ${result.outputPath}`);
  console.error(`[iq-blogger] ${result.wordCount} words | ${result.attempts} attempt${result.attempts === 1 ? '' : 's'} | $${result.cost.toFixed(4)}`);

  return 0;
}

function printConvertFolderHelp(): void {
  console.error(
      [
        'Usage: tsx src/index.ts convert-folder [options] <folder-path>',
        '',
        'Required flags:',
        '  --source <owner/repo>       e.g. iq-dev-lab/redis-deep-dive',
        '  --folder <name>             folder name within repo, e.g. redis-internals',
        '  --title <string>            display title, e.g. "Redis Internals"',
        '',
        'Optional flags:',
        '  --out <dir>                 output directory (default: ./drafts)',
        '  --date <YYYY-MM-DD>         override pubDate (default: today)',
        '  --force                     re-convert even if already done',
        '',
        'Example:',
        '  tsx src/index.ts convert-folder \\',
        '    --source iq-dev-lab/redis-deep-dive \\',
        '    --folder redis-internals \\',
        '    --title "Redis Internals" \\',
        '    ./test-inputs/redis-deep-dive/redis-internals',
      ].join('\n'),
  );
}

/* ─────────────────────────────────────────────────────────────
   Command: clone (testing git-ops module)
   ───────────────────────────────────────────────────────────── */

async function cmdClone(args: Args): Promise<number> {
  const source = args.positional[0];
  if (!source) {
    console.error('Error: clone requires a source argument.');
    console.error('Usage: tsx src/index.ts clone <org/repo>');
    console.error('Example: tsx src/index.ts clone iq-ai-lab/transformer-deep-dive');
    return 2;
  }

  try {
    const result = await cloneOrPull({
      source,
      force: args.flags.force === 'true',
    });
    console.error('');
    console.error(`[iq-blogger] ✅ ${result.action} → ${result.path}`);
    console.error(`[iq-blogger] Took ${result.durationMs}ms`);
    return 0;
  } catch (err) {
    console.error('');
    console.error(`[iq-blogger] ❌ Failed: ${(err as Error).message}`);
    return 1;
  }
}

/* ─────────────────────────────────────────────────────────────
   Command: convert-repo
   ───────────────────────────────────────────────────────────── */

async function cmdConvertRepo(args: Args): Promise<number> {
  const source = args.positional[0];
  if (!source) {
    console.error('Error: convert-repo requires a source argument.');
    console.error('');
    printConvertRepoHelp();
    return 2;
  }

  // Validate source format (org/repo)
  if (!source.includes('/') || source.split('/').length !== 2) {
    console.error(`Error: source must be in "org/repo" format, got "${source}"`);
    return 2;
  }

  try {
    const summary = await convertRepo({
      source,
      title: args.flags.title,
      only: args.flags.only,
      outDir: args.flags.out,
      skipIfDone: args.flags.force !== 'true',
      forceClone: args.flags['force-clone'] === 'true',
    });

    // Print summary
    console.error('');
    console.error('━'.repeat(50));
    console.error(`Summary for ${source}:`);
    console.error(`  ✅ Done:     ${summary.done}`);
    console.error(`  ⏭️  Skipped:  ${summary.skipped}`);
    console.error(`  ❌ Failed:   ${summary.failed}`);
    console.error(`  Total cost: $${summary.totalCost.toFixed(2)}`);
    console.error(`  Duration:   ${(summary.durationMs / 1000).toFixed(1)}s`);

    return summary.failed > 0 ? 1 : 0;
  } catch (err) {
    console.error('');
    console.error(`[iq-blogger] ❌ Failed: ${(err as Error).message}`);
    return 1;
  }
}

function printConvertRepoHelp(): void {
  console.error(
      [
        'Usage: tsx src/index.ts convert-repo <org/repo> [options]',
        '',
        'Required:',
        '  <org/repo>            e.g. iq-ai-lab/transformer-deep-dive',
        '',
        'Optional flags:',
        '  --title <string>      override series title (default: derived from repo)',
        '  --only <folder>       process only one folder (e.g. ch1-attention-decomposition)',
        '  --out <dir>           output directory (default: ./drafts)',
        '  --force               re-convert even if already done',
        '  --force-clone         delete cache and re-clone',
        '',
        'Examples:',
        '  tsx src/index.ts convert-repo iq-ai-lab/transformer-deep-dive',
        '  tsx src/index.ts convert-repo iq-dev-lab/redis-deep-dive --only redis-internals',
      ].join('\n'),
  );
}

/* ─────────────────────────────────────────────────────────────
   Command: deploy
   ───────────────────────────────────────────────────────────── */

async function cmdDeploy(args: Args): Promise<number> {
  const targetPath = args.flags.target ?? process.env.IQ_PROOF_PATH;

  if (!targetPath) {
    console.error('Error: --target or IQ_PROOF_PATH env var required');
    console.error('');
    printDeployHelp();
    return 2;
  }

  const expandedPath = expandHome(targetPath);

  try {
    console.error(`[publisher] Deploying to ${expandedPath}...`);

    const result = await deploy({
      targetPath: expandedPath,
      repo: args.flags.repo,
      dryRun: args.flags['dry-run'] === 'true',
      skipGit: args.flags['skip-git'] === 'true',
    });

    if (result.copied.length === 0) {
      console.error(`[publisher] No files to deploy.`);
      return 0;
    }

    console.error('');
    console.error(`[publisher] ✅ Deployed ${result.copied.length} file(s):`);
    for (const file of result.copied) {
      console.error(`  → ${file}`);
    }

    if (result.failed.length > 0) {
      console.error('');
      console.error(`[publisher] ❌ Failed ${result.failed.length} file(s):`);
      for (const item of result.failed) {
        console.error(`  ${item.file}: ${item.error}`);
      }
      return 1;
    }

    if (result.gitCommit) {
      console.error('');
      console.error(`[publisher] ✅ Committed: "${result.gitCommit}"`);
    }

    if (result.gitPushed) {
      console.error(`[publisher] ✅ Pushed to GitHub`);
      console.error(`[publisher] 🚀 GitHub Pages will rebuild in ~5 minutes`);
      console.error(`[publisher] 💡 If issues found, use: tsx src/index.ts revert --repo ${args.flags.repo ?? '<repo>'}`);
    }

    return 0;
  } catch (err) {
    console.error(`[publisher] ❌ ${(err as Error).message}`);
    return 1;
  }
}

function printDeployHelp(): void {
  console.error([
    'Usage: tsx src/index.ts deploy [options]',
    '',
    'Deploy generated posts to the blog repo (full automation):',
    '  1. Copy .mdx files from drafts/ to blog repo posts/',
    '  2. Flip frontmatter draft: true → draft: false',
    '  3. git add + commit + push (auto-deploy via GitHub Pages)',
    '',
    'Required:',
    '  --target <path>     Blog repo root (or set IQ_PROOF_PATH env var)',
    '',
    'Optional:',
    '  --repo <org/repo>   Only deploy posts from this source repo',
    '  --dry-run           Show what would be done',
    '  --skip-git          Copy + flip draft only, skip git operations',
    '',
    'Examples:',
    '  tsx src/index.ts deploy --repo iq-ai-lab/transformer-deep-dive',
    '  tsx src/index.ts deploy --dry-run',
    '',
    'Recovery:',
    '  If a post needs retraction: tsx src/index.ts revert --repo <repo>',
  ].join('\n'));
}

/* ─────────────────────────────────────────────────────────────
   Command: revert
   ───────────────────────────────────────────────────────────── */

async function cmdRevert(args: Args): Promise<number> {
  const targetPath = args.flags.target ?? process.env.IQ_PROOF_PATH;

  if (!targetPath) {
    console.error('Error: --target or IQ_PROOF_PATH env var required');
    console.error('');
    printRevertHelp();
    return 2;
  }

  if (!args.flags.repo && !args.flags.slug) {
    console.error('Error: --repo or --slug required');
    console.error('');
    printRevertHelp();
    return 2;
  }

  const expandedPath = expandHome(targetPath);

  try {
    console.error(`[publisher] Reverting from ${expandedPath}...`);

    const result = await revert({
      targetPath: expandedPath,
      repo: args.flags.repo,
      slug: args.flags.slug,
      dryRun: args.flags['dry-run'] === 'true',
      skipGit: args.flags['skip-git'] === 'true',
    });

    if (result.removed.length === 0) {
      console.error(`[publisher] No matching posts to revert.`);
      return 0;
    }

    console.error('');
    console.error(`[publisher] ✅ Removed ${result.removed.length} file(s):`);
    for (const file of result.removed) {
      console.error(`  ✗ ${file}`);
    }

    if (result.failed.length > 0) {
      console.error('');
      console.error(`[publisher] ❌ Failed ${result.failed.length} file(s):`);
      for (const item of result.failed) {
        console.error(`  ${item.file}: ${item.error}`);
      }
      return 1;
    }

    if (result.gitCommit) {
      console.error('');
      console.error(`[publisher] ✅ Committed: "${result.gitCommit}"`);
    }

    if (result.gitPushed) {
      console.error(`[publisher] ✅ Pushed to GitHub`);
      console.error(`[publisher] 🚀 GitHub Pages will rebuild in ~5 minutes`);
    }

    return 0;
  } catch (err) {
    console.error(`[publisher] ❌ ${(err as Error).message}`);
    return 1;
  }
}

function printRevertHelp(): void {
  console.error([
    'Usage: tsx src/index.ts revert [options]',
    '',
    'Revert published posts (remove from blog + commit + push):',
    '',
    'Required (one of):',
    '  --repo <org/repo>   Revert all posts from this source repo',
    '  --slug <name>       Revert a single post by slug (e.g. ch7-llm-icl)',
    '',
    'Optional:',
    '  --target <path>     Blog repo root (or set IQ_PROOF_PATH env var)',
    '  --dry-run           Show what would be done',
    '  --skip-git          Remove files only, skip git operations',
    '',
    'Examples:',
    '  # Revert all transformer posts',
    '  tsx src/index.ts revert --repo iq-ai-lab/transformer-deep-dive',
    '',
    '  # Revert a single post',
    '  tsx src/index.ts revert --slug ch7-llm-icl',
  ].join('\n'));
}

/* ─────────────────────────────────────────────────────────────
   Helper
   ───────────────────────────────────────────────────────────── */

function expandHome(path: string): string {
  return path.startsWith('~')
      ? path.replace(/^~/, process.env.HOME ?? '')
      : path;
}

main();
