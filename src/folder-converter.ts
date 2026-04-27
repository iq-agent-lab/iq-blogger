/**
 * iq-blogger — Folder Converter
 *
 * Converts a folder of deep-dive chapters into ONE synthesized blog post.
 *
 * Flow:
 *   1. Discover chapter files (pattern: NN-name.md, README excluded).
 *   2. Sort naturally (01, 02, ..., 10, 11) using locale-aware compare.
 *   3. Concatenate all chapters into one input string.
 *   4. Call agent.convert() once with the combined input.
 *   5. Save output as drafts/{repo}/{folder}.mdx.
 *   6. Update progress.json.
 *
 * One folder = one LLM call = one synthesized post.
 * If the folder has 7 chapters, all 7 go into one prompt.
 */

import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, basename } from 'node:path';
import { convert } from './agent';
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
   Public API
   ───────────────────────────────────────────────────────────── */

export interface FolderConvertOptions {
  /** Full repo identifier, e.g. "iq-dev-lab/redis-deep-dive". */
  source: string;
  /** Folder name within the repo, e.g. "redis-internals". */
  folder: string;
  /** Display title for the series, e.g. "Redis Internals". */
  title: string;
  /** Local filesystem path to the folder containing chapter .md files. */
  folderPath: string;
  /** Output directory (drafts root). Default: "./drafts". */
  outDir?: string;
  /** Path to progress file. Default: "./drafts/progress.json". */
  progressPath?: string;
  /** Skip if already done. Default: true. Set false to force re-conversion. */
  skipIfDone?: boolean;
  /** Override pubDate (default: today). */
  date?: string;
}

export type FolderConvertResult =
    | {
  ok: true;
  outputPath: string;
  slug: string;
  chaptersUsed: number;
  attempts: number;
  cost: number;
  wordCount: number;
}
    | {
  ok: false;
  reason: string;
  issues?: string[];
};

/**
 * Convert a folder of chapters into one synthesized post.
 */
export async function convertFolder(options: FolderConvertOptions): Promise<FolderConvertResult> {
  const outDir = options.outDir ?? './drafts';
  const progressPath = options.progressPath ?? `${outDir}/progress.json`;
  const skipIfDone = options.skipIfDone ?? true;

  // 1. Discover chapter files
  const chapters = await discoverChapters(options.folderPath);

  if (chapters.length === 0) {
    return {
      ok: false,
      reason: `No chapter files found in ${options.folderPath} (expected NN-name.md pattern)`,
    };
  }

  // 2. Load progress, register folder
  const progress = await loadProgress(progressPath);
  ensureFolder(progress, {
    repo: options.source,
    folder: options.folder,
    title: options.title,
    chaptersTotal: chapters.length,
  });

  // 3. Skip if already done
  if (skipIfDone && isFolderDone(progress, options.source, options.folder)) {
    return {
      ok: false,
      reason: `Folder "${options.folder}" already converted. Use --force to re-convert.`,
    };
  }

  // 4. Mark in-progress, save progress
  markFolderStarted(progress, options.source, options.folder);
  await saveProgress(progressPath, progress);

  // 5. Read and concatenate chapters
  const combined = await concatenateChapters(options.folderPath, chapters);

  // 6. Extract series metadata from folder name and repo
  // Folder "ch2-transformer-architecture" → order: 2
  // Repo "iq-ai-lab/transformer-deep-dive" → seriesSlug: "transformer-deep-dive"
  const orderMatch = options.folder.match(/^ch(\d+)/);
  const order = orderMatch && orderMatch[1] ? parseInt(orderMatch[1], 10) : 1;
  const seriesSlug = options.source.split('/').pop() ?? options.folder;

  // 7. Build conversion input
  const input: ConversionInput = {
    sourceRepo: options.source,
    sourcePath: seriesSlug,      // pass repo-level slug for series.slug
    chapterOrder: order,          // extracted from "chN-..." prefix
    chapterTitle: options.title,
    runDate: options.date ?? today(),
    content: combined,
  };

  // 7. Call agent
  console.error(`[iq-blogger] Synthesizing ${options.folder} (${chapters.length} chapters)...`);
  const result = await convert(input);

  // 8. Update progress + save output
  if (!result.ok) {
    markFolderFailed(
        progress,
        options.source,
        options.folder,
        result.reason,
        result.history.length,
    );
    await saveProgress(progressPath, progress);
    return {
      ok: false,
      reason: result.reason,
      issues: result.issues.map((i) => `[${i.severity}] [${i.rule}] ${i.message}`),
    };
  }

  // 9. Write output: drafts/{repo}/{folder}.mdx
  // Use a flatter path: replace '/' in repo with '-' for filesystem safety,
  // but keep the structure visible.
  const repoSlug = options.source.replace(/\//g, '-'); // "iq-dev-lab/redis-deep-dive" → "iq-dev-lab-redis-deep-dive"
  const outputDir = resolve(outDir, repoSlug);
  await mkdir(outputDir, { recursive: true });

  const outputPath = resolve(outputDir, `${options.folder}.mdx`);
  await writeFile(outputPath, result.mdx, 'utf-8');

  // 10. Update progress with success info
  const lastAttempt = result.history[result.history.length - 1];
  const wordCount = lastAttempt?.validation.metrics.wordCount ?? 0;
  const warnings = lastAttempt?.validation.issues
  .filter((i) => i.severity === 'warning')
  .map((i) => `[${i.rule}] ${i.message}`) ?? [];

  markFolderDone(progress, options.source, options.folder, {
    outputSlug: options.folder,
    attempts: result.history.length,
    cost: result.usage.estimatedCostUsd,
    wordCount,
    warnings,
  });
  await saveProgress(progressPath, progress);

  return {
    ok: true,
    outputPath,
    slug: options.folder,
    chaptersUsed: chapters.length,
    attempts: result.history.length,
    cost: result.usage.estimatedCostUsd,
    wordCount,
  };
}

/* ─────────────────────────────────────────────────────────────
   Chapter discovery
   ───────────────────────────────────────────────────────────── */

/**
 * Discover chapter files in a folder.
 * Rules:
 *   - Match pattern: NN-name.md (e.g. 01-single-thread.md, 10-cluster.md)
 *   - Exclude README.md and other non-numbered files
 *   - Sort naturally (01, 02, ..., 10, 11) not alphabetically
 */
async function discoverChapters(folderPath: string): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(folderPath);
  } catch (err) {
    throw new Error(`Cannot read folder ${folderPath}: ${(err as Error).message}`);
  }

  // Filter: must match NN-...md pattern
  const chapterPattern = /^\d+[-_].+\.md$/i;
  const chapters = entries.filter((name) => chapterPattern.test(name));

  // Natural sort: 01, 02, ..., 09, 10, 11 (not 01, 10, 11, 02)
  chapters.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));

  return chapters;
}

/**
 * Read all chapter files and concatenate them with delimiters.
 * Each chapter gets a clear header so the LLM can recognize boundaries.
 */
async function concatenateChapters(folderPath: string, chapterFiles: string[]): Promise<string> {
  const parts: string[] = [];

  for (const filename of chapterFiles) {
    const filePath = resolve(folderPath, filename);
    const content = await readFile(filePath, 'utf-8');

    parts.push(`<!-- CHAPTER: ${filename} -->`);
    parts.push(content);
    parts.push(''); // blank line between chapters
  }

  return parts.join('\n');
}

/* ─────────────────────────────────────────────────────────────
   Helpers
   ───────────────────────────────────────────────────────────── */

function today(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
