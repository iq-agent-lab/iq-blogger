/**
 * iq-blogger — Batch Converter
 *
 * Convert multiple repos × folders in one Message Batches API request.
 *
 * Flow:
 *   1. Clone/update each source repo (.cache/sources/{org}/{repo}).
 *   2. Discover chapter folders for each repo.
 *   3. For each folder: read + concatenate chapters, build a batch request item.
 *   4. Submit ONE batch with all items (custom_id = "{source}__{folder}").
 *   5. Poll batch status until ended.
 *   6. Stream results:
 *        - validate output → write MDX, mark done
 *        - on validation failure / errored / expired: fall back to sync convertFolder()
 *   7. Print summary.
 *
 * Why batch:
 *   - 50% off all token usage (stacks with prompt caching → ~57% total savings).
 *   - Many folders queued at once → server-side parallelism.
 *
 * Trade-offs:
 *   - Up to 24h SLA (typically <1h for small batches).
 *   - No real-time per-folder feedback during polling.
 *   - Validation failures require sync fallback (no inline retry inside batch).
 */

import Anthropic from '@anthropic-ai/sdk';
import { resolve } from 'node:path';
import { writeFile, mkdir } from 'node:fs/promises';
import {
  buildAgentRequestParams,
  loadAgentPrompts,
  extractMdxFromMessage,
  estimateMessageCost,
} from './agent';
import { discoverFolders, deriveRepoTitle } from './repo-converter';
import {
  discoverChapters,
  concatenateChapters,
  convertFolder,
} from './folder-converter';
import { cloneOrPull } from './git-ops';
import { validate } from './validator';
import {
  loadProgress,
  saveProgress,
  ensureFolder,
  markFolderStarted,
  markFolderDone,
  markFolderFailed,
  isFolderDone,
} from './progress';
import type { ConversionInput } from './types';

/* ─────────────────────────────────────────────────────────────
   Configuration
   ───────────────────────────────────────────────────────────── */

/** Batch API gives 50% off all token usage. Applied when reporting batch costs. */
const BATCH_DISCOUNT_MULTIPLIER = 0.5;

/** How often to poll batch status (ms). 30s is a reasonable default. */
const POLL_INTERVAL_MS = 30_000;

/* ─────────────────────────────────────────────────────────────
   Public API
   ───────────────────────────────────────────────────────────── */

export interface BatchConvertOptions {
  /** List of "org/repo" identifiers. */
  sources: string[];
  /** Override series title for each repo: { "org/repo": "Custom Title" }. */
  titleOverrides?: Record<string, string>;
  /** Restrict to specific folders within a repo: { "org/repo": ["ch1-x", "ch2-y"] }. */
  onlyFolders?: Record<string, string[]>;
  /** Output directory. Default: "./drafts". */
  outDir?: string;
  /** Skip already-done folders (per progress.json). Default: true. */
  skipIfDone?: boolean;
  /** Cache dir for cloned sources. Default: ".cache/sources". */
  cacheDir?: string;
  /** Force re-clone (delete cache). Default: false. */
  forceClone?: boolean;
  /** Override pubDate (default: today). */
  date?: string;
  /** Path to progress file. Default: "{outDir}/progress.json". */
  progressPath?: string;
  /** Prompts dir. Default: ../prompts. */
  promptsDir?: string;
  /**
   * If true, treat batch validation failures as terminal (don't try sync fallback).
   * Default: false. Disable when you want pure batch cost discipline at the
   * expense of some per-folder failures.
   */
  noFallback?: boolean;
}

export interface BatchConvertSummary {
  totalRepos: number;
  totalFolders: number;
  done: number;
  failed: number;
  skipped: number;
  /** How many folders fell back to sync conversion after batch failure. */
  fallbackInvoked: number;
  /** Total cost across batch + fallback (USD). */
  totalCost: number;
  durationMs: number;
  /** Anthropic batch_id — useful for debugging or manual retrieval. */
  batchId: string;
  results: BatchFolderResult[];
}

export interface BatchFolderResult {
  source: string;
  folder: string;
  status: 'done' | 'failed' | 'skipped';
  details: string;
  cost?: number;
  fallbackUsed?: boolean;
}

/**
 * Convert all folders in the listed repos via a single Message Batches request.
 */
export async function convertBatch(options: BatchConvertOptions): Promise<BatchConvertSummary> {
  const startTime = Date.now();
  const outDir = options.outDir ?? './drafts';
  const progressPath = options.progressPath ?? `${outDir}/progress.json`;
  const skipIfDone = options.skipIfDone ?? true;

  if (options.sources.length === 0) {
    throw new Error('convert-batch requires at least one source repo.');
  }

  // 1. Clone/update all repos (parallel — I/O bound)
  console.error(`[batch] Preparing ${options.sources.length} repo(s)...`);
  const cloneResults = await Promise.all(
    options.sources.map((source) =>
      cloneOrPull({
        source,
        cacheDir: options.cacheDir,
        force: options.forceClone,
      }).then((r) => ({ source, path: r.path })),
    ),
  );

  // 2. Load prompts ONCE (reused across all batch items — same bytes by design,
  //    which is what makes the few-shot cache_control marker effective).
  const prompts = await loadAgentPrompts(options.promptsDir);

  // 3. Build batch items + collect skips/discovery failures
  const progress = await loadProgress(progressPath);
  const items: PreparedItem[] = [];
  const preliminaryResults: BatchFolderResult[] = [];

  for (const { source, path: repoPath } of cloneResults) {
    const folders = await discoverFolders(repoPath);
    const onlyForRepo = options.onlyFolders?.[source];
    const targetFolders = onlyForRepo
      ? folders.filter((f) => onlyForRepo.includes(f))
      : folders;
    const title = options.titleOverrides?.[source] ?? deriveRepoTitle(source);

    for (const folder of targetFolders) {
      const folderPath = resolve(repoPath, folder);
      const chapters = await discoverChapters(folderPath);

      ensureFolder(progress, {
        repo: source,
        folder,
        title,
        chaptersTotal: chapters.length,
      });

      if (chapters.length === 0) {
        preliminaryResults.push({
          source,
          folder,
          status: 'failed',
          details: 'no chapter files found',
        });
        continue;
      }

      if (skipIfDone && isFolderDone(progress, source, folder)) {
        preliminaryResults.push({
          source,
          folder,
          status: 'skipped',
          details: 'already converted',
        });
        continue;
      }

      const combined = await concatenateChapters(folderPath, chapters);
      const orderMatch = folder.match(/^ch(\d+)/);
      const order = orderMatch?.[1] ? parseInt(orderMatch[1], 10) : 1;
      const seriesSlug = source.split('/').pop() ?? folder;

      const input: ConversionInput = {
        sourceRepo: source,
        sourcePath: seriesSlug,
        chapterOrder: order,
        chapterTitle: title,
        runDate: options.date ?? today(),
        content: combined,
      };

      const request = buildAgentRequestParams(input, prompts);
      const customId = makeCustomId(source, folder);
      const repoSlug = source.replace(/\//g, '-');
      const outputPath = resolve(outDir, repoSlug, `${folder}.mdx`);

      items.push({
        source,
        folder,
        title,
        folderPath,
        customId,
        outputPath,
        request,
      });
    }
  }
  await saveProgress(progressPath, progress);

  if (items.length === 0) {
    console.error('[batch] Nothing to do (all folders already done or skipped).');
    return summarize(options.sources.length, preliminaryResults, '', 0, startTime);
  }

  console.error(`[batch] Submitting batch with ${items.length} request(s)...`);

  // 4. Submit batch
  const client = new Anthropic();
  const batch = await client.messages.batches.create({
    requests: items.map((item) => ({
      custom_id: item.customId,
      params: item.request,
    })),
  });

  console.error(`[batch] Batch ID: ${batch.id}`);
  console.error(`[batch] Initial status: ${batch.processing_status}`);

  // Mark all as started in progress (so a crash during polling leaves a record)
  for (const item of items) {
    markFolderStarted(progress, item.source, item.folder);
  }
  await saveProgress(progressPath, progress);

  // 5. Poll until done
  let polled = batch;
  while (polled.processing_status !== 'ended') {
    await sleep(POLL_INTERVAL_MS);
    polled = await client.messages.batches.retrieve(batch.id);
    console.error(`[batch] ${polled.processing_status} | ${formatCounts(polled.request_counts)}`);
  }
  console.error(`[batch] Batch ended. Streaming results...`);

  // 6. Process results
  const itemMap = new Map(items.map((i) => [i.customId, i]));
  const results: BatchFolderResult[] = [...preliminaryResults];
  let fallbackInvoked = 0;

  for await (const result of await client.messages.batches.results(batch.id)) {
    const item = itemMap.get(result.custom_id);
    if (!item) {
      console.error(`[batch] WARNING: result with unknown custom_id "${result.custom_id}"`);
      continue;
    }

    const folderResult = await processResult(result, item, {
      outDir,
      progressPath,
      noFallback: options.noFallback ?? false,
    });

    if (folderResult.fallbackUsed) fallbackInvoked++;
    results.push(folderResult);
  }

  return summarize(options.sources.length, results, batch.id, fallbackInvoked, startTime);
}

/* ─────────────────────────────────────────────────────────────
   Internal types
   ───────────────────────────────────────────────────────────── */

interface PreparedItem {
  source: string;
  folder: string;
  title: string;
  folderPath: string;
  customId: string;
  outputPath: string;
  request: ReturnType<typeof buildAgentRequestParams>;
}

interface ProcessContext {
  outDir: string;
  progressPath: string;
  noFallback: boolean;
}

/* ─────────────────────────────────────────────────────────────
   Result processing
   ───────────────────────────────────────────────────────────── */

async function processResult(
  result: Anthropic.Messages.MessageBatchIndividualResponse,
  item: PreparedItem,
  ctx: ProcessContext,
): Promise<BatchFolderResult> {
  // Non-success outcomes — fall back unless disabled
  if (result.result.type === 'errored') {
    const errMsg = result.result.error.error.message;
    return ctx.noFallback
      ? await markBatchFailure(item, ctx, `errored: ${errMsg}`)
      : await fallbackToSync(item, ctx, `batch errored: ${errMsg}`);
  }
  if (result.result.type === 'expired') {
    return ctx.noFallback
      ? await markBatchFailure(item, ctx, 'batch expired (24h)')
      : await fallbackToSync(item, ctx, 'batch expired');
  }
  if (result.result.type === 'canceled') {
    return await markBatchFailure(item, ctx, 'batch canceled');
  }

  // Succeeded — validate output
  const message = result.result.message;
  const mdx = extractMdxFromMessage(message);
  const batchCost = estimateMessageCost(item.request.model, message.usage) * BATCH_DISCOUNT_MULTIPLIER;

  // Model-emitted ERROR sentinel
  if (mdx.startsWith('ERROR:')) {
    if (ctx.noFallback) {
      return await markBatchFailure(item, ctx, `model declined: ${mdx.slice(0, 200)}`, batchCost);
    }
    const fb = await fallbackToSync(item, ctx, 'model declined batch attempt');
    return { ...fb, cost: batchCost + (fb.cost ?? 0) };
  }

  const validation = validate(mdx);
  if (!validation.ok) {
    if (ctx.noFallback) {
      const issuesSummary = validation.issues
        .filter((i) => i.severity === 'error')
        .map((i) => `[${i.rule}] ${i.message}`)
        .join('; ');
      return await markBatchFailure(item, ctx, `validation failed: ${issuesSummary}`, batchCost);
    }
    const fb = await fallbackToSync(item, ctx, 'validation failed in batch');
    return { ...fb, cost: batchCost + (fb.cost ?? 0) };
  }

  // Validation passed — write MDX + mark done
  await mkdir(resolve(item.outputPath, '..'), { recursive: true });
  await writeFile(item.outputPath, mdx, 'utf-8');

  const wordCount = validation.metrics.wordCount;
  const warnings = validation.issues
    .filter((i) => i.severity === 'warning')
    .map((i) => `[${i.rule}] ${i.message}`);

  const progress = await loadProgress(ctx.progressPath);
  markFolderDone(progress, item.source, item.folder, {
    outputSlug: item.folder,
    attempts: 1,
    cost: batchCost,
    wordCount,
    warnings,
  });
  await saveProgress(ctx.progressPath, progress);

  console.error(
    `[batch] ✅ ${item.source}/${item.folder} (${wordCount}w, $${batchCost.toFixed(4)})`,
  );

  return {
    source: item.source,
    folder: item.folder,
    status: 'done',
    details: `${wordCount} words, batch (1 attempt)`,
    cost: batchCost,
  };
}

/**
 * Fall back to the sync convertFolder() flow.
 * convertFolder handles its own retries, validation, output write, and progress.
 */
async function fallbackToSync(
  item: PreparedItem,
  ctx: ProcessContext,
  reason: string,
): Promise<BatchFolderResult> {
  console.error(`[batch] ⚠️  ${item.source}/${item.folder}: ${reason} — falling back to sync...`);

  try {
    const r = await convertFolder({
      source: item.source,
      folder: item.folder,
      title: item.title,
      folderPath: item.folderPath,
      outDir: ctx.outDir,
      progressPath: ctx.progressPath,
      skipIfDone: false, // we explicitly chose to fall back; don't skip
    });

    if (!r.ok) {
      return {
        source: item.source,
        folder: item.folder,
        status: 'failed',
        details: `sync fallback failed: ${r.reason}`,
        fallbackUsed: true,
      };
    }

    console.error(
      `[batch] ✅ ${item.source}/${item.folder} via sync (${r.attempts} attempt${r.attempts === 1 ? '' : 's'}, $${r.cost.toFixed(4)})`,
    );

    return {
      source: item.source,
      folder: item.folder,
      status: 'done',
      details: `via sync fallback, ${r.attempts} attempt(s), ${r.wordCount}w`,
      cost: r.cost,
      fallbackUsed: true,
    };
  } catch (err) {
    return {
      source: item.source,
      folder: item.folder,
      status: 'failed',
      details: `sync fallback threw: ${(err as Error).message}`,
      fallbackUsed: true,
    };
  }
}

async function markBatchFailure(
  item: PreparedItem,
  ctx: ProcessContext,
  reason: string,
  cost?: number,
): Promise<BatchFolderResult> {
  const progress = await loadProgress(ctx.progressPath);
  markFolderFailed(progress, item.source, item.folder, reason, 1);
  await saveProgress(ctx.progressPath, progress);
  console.error(`[batch] ❌ ${item.source}/${item.folder}: ${reason}`);
  return {
    source: item.source,
    folder: item.folder,
    status: 'failed',
    details: reason,
    ...(cost !== undefined ? { cost } : {}),
  };
}

/* ─────────────────────────────────────────────────────────────
   Helpers
   ───────────────────────────────────────────────────────────── */

/**
 * Build a Batch API custom_id from source + folder.
 * Constraints: ≤64 chars, alphanumeric + - _ .
 *   "iq-ai-lab/foo-deep-dive" + "ch1-setup" → "iq-ai-lab--foo-deep-dive__ch1-setup"
 * If too long, repo portion is truncated; folder is preserved (it's the discriminator).
 */
function makeCustomId(source: string, folder: string): string {
  const sourceFlat = source.replace('/', '--');
  const id = `${sourceFlat}__${folder}`;
  if (id.length <= 64) return id;
  const folderPart = `__${folder}`;
  const repoBudget = Math.max(1, 64 - folderPart.length);
  return sourceFlat.slice(0, repoBudget) + folderPart;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function formatCounts(counts: Anthropic.Messages.MessageBatchRequestCounts): string {
  return `processing=${counts.processing} ✓${counts.succeeded} ✗${counts.errored} ⊘${counts.canceled} ⌛${counts.expired}`;
}

function summarize(
  totalRepos: number,
  results: BatchFolderResult[],
  batchId: string,
  fallbackInvoked: number,
  startTime: number,
): BatchConvertSummary {
  const done = results.filter((r) => r.status === 'done').length;
  const failed = results.filter((r) => r.status === 'failed').length;
  const skipped = results.filter((r) => r.status === 'skipped').length;
  const totalCost = results.reduce((sum, r) => sum + (r.cost ?? 0), 0);
  return {
    totalRepos,
    totalFolders: results.length,
    done,
    failed,
    skipped,
    fallbackInvoked,
    totalCost,
    durationMs: Date.now() - startTime,
    batchId,
    results,
  };
}

function today(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
