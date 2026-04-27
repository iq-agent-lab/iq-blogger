/**
 * iq-blogger — Repo Converter
 *
 * Top-level orchestrator: clones a source repo, discovers all chapter folders,
 * and converts each into a synthesis post.
 *
 * Flow:
 *   1. Clone or pull the source repo (.cache/sources/{org}/{repo}).
 *   2. Discover chapter folders inside the repo.
 *   3. For each folder: call convertFolder() (skips already-done folders).
 *   4. Print summary at end.
 *
 * Folder discovery:
 *   - Pattern A: ch[N]-... (e.g. ch1-attention-decomposition)
 *   - Pattern B: any non-hidden directory containing .md files
 *   - README.md, LICENSE, etc. excluded automatically
 */

import { readdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { cloneOrPull } from './git-ops';
import { convertFolder, type FolderConvertResult } from './folder-converter';

/* ─────────────────────────────────────────────────────────────
   Public API
   ───────────────────────────────────────────────────────────── */

export interface RepoConvertOptions {
  /** "org/repo" identifier, e.g. "iq-ai-lab/transformer-deep-dive". */
  source: string;
  /** Override series title. Default: derived from repo name. */
  title?: string;
  /** Process only specific folder (skip others). */
  only?: string;
  /** Output directory. Default: "./drafts". */
  outDir?: string;
  /** Skip already-done folders. Default: true. */
  skipIfDone?: boolean;
  /** Cache dir for cloned sources. Default: ".cache/sources". */
  cacheDir?: string;
  /** Force re-clone (delete cache). Default: false. */
  forceClone?: boolean;
}

export interface RepoConvertSummary {
  totalFolders: number;
  done: number;
  failed: number;
  skipped: number;
  totalCost: number;
  durationMs: number;
  results: FolderResult[];
}

export interface FolderResult {
  folder: string;
  status: 'done' | 'failed' | 'skipped';
  details: string;
  cost?: number;
}

/**
 * Clone repo and convert all chapter folders.
 */
export async function convertRepo(options: RepoConvertOptions): Promise<RepoConvertSummary> {
  const startTime = Date.now();

  // 1. Clone/pull source
  const cloneResult = await cloneOrPull({
    source: options.source,
    cacheDir: options.cacheDir,
    force: options.forceClone,
  });

  // 2. Discover folders
  const folders = await discoverFolders(cloneResult.path);

  if (folders.length === 0) {
    return {
      totalFolders: 0,
      done: 0,
      failed: 0,
      skipped: 0,
      totalCost: 0,
      durationMs: Date.now() - startTime,
      results: [],
    };
  }

  // 3. Filter if --only specified
  const targetFolders = options.only
      ? folders.filter((f) => f === options.only)
      : folders;

  if (options.only && targetFolders.length === 0) {
    throw new Error(
        `Folder "${options.only}" not found in repo. Available: ${folders.join(', ')}`,
    );
  }

  // 4. Derive title (from repo name if not given)
  const seriesTitle = options.title ?? deriveRepoTitle(options.source);

  // 5. Process each folder
  console.error('');
  console.error(`[repo-converter] Found ${targetFolders.length} folder(s) to process`);
  console.error('');

  const results: FolderResult[] = [];
  let totalCost = 0;
  let done = 0;
  let failed = 0;
  let skipped = 0;

  for (let i = 0; i < targetFolders.length; i++) {
    const folder = targetFolders[i];
    if (!folder) continue;

    const folderPath = resolve(cloneResult.path, folder);
    const progress = `[${i + 1}/${targetFolders.length}]`;

    process.stderr.write(`${progress} ${folder} ... `);

    let result: FolderConvertResult;
    try {
      result = await convertFolder({
        source: options.source,
        folder,
        title: seriesTitle,
        folderPath,
        outDir: options.outDir,
        skipIfDone: options.skipIfDone ?? true,
      });
    } catch (err) {
      const reason = (err as Error).message;
      console.error(`❌ error (${reason})`);
      failed++;
      results.push({ folder, status: 'failed', details: reason });
      continue;
    }

    if (result.ok) {
      console.error(`✅ done (${result.wordCount}w, ${result.attempts} attempt${result.attempts === 1 ? '' : 's'}, $${result.cost.toFixed(2)})`);
      done++;
      totalCost += result.cost;
      results.push({
        folder,
        status: 'done',
        details: `${result.wordCount} words, ${result.attempts} attempt(s)`,
        cost: result.cost,
      });
    } else {
      // Check if it's a "skip" (already done) vs real failure
      if (result.reason.includes('already converted')) {
        console.error(`⏭️  skipped (already done)`);
        skipped++;
        results.push({ folder, status: 'skipped', details: result.reason });
      } else {
        console.error(`❌ failed (${result.reason})`);
        failed++;
        results.push({ folder, status: 'failed', details: result.reason });
      }
    }
  }

  return {
    totalFolders: targetFolders.length,
    done,
    failed,
    skipped,
    totalCost,
    durationMs: Date.now() - startTime,
    results,
  };
}

/* ─────────────────────────────────────────────────────────────
   Folder discovery
   ───────────────────────────────────────────────────────────── */

/**
 * Find all chapter folders in a repo.
 *
 * Rules:
 *   - Must be a directory (not a file)
 *   - Must not start with . or _ (hidden/internal)
 *   - Must contain at least one chapter file (NN-name.md)
 *   - Sorted naturally (ch1, ch2, ..., ch10, ch11)
 */
async function discoverFolders(repoPath: string): Promise<string[]> {
  const entries = await readdir(repoPath);
  const candidates: string[] = [];

  for (const name of entries) {
    if (name.startsWith('.') || name.startsWith('_')) continue;

    const fullPath = resolve(repoPath, name);
    const stats = await stat(fullPath);
    if (!stats.isDirectory()) continue;

    // Check if folder contains chapter files
    const hasChapters = await containsChapters(fullPath);
    if (hasChapters) {
      candidates.push(name);
    }
  }

  // Natural sort: ch1, ch2, ..., ch10, ch11
  candidates.sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }),
  );

  return candidates;
}

/**
 * Check if a folder contains at least one chapter file (NN-name.md).
 */
async function containsChapters(folderPath: string): Promise<boolean> {
  try {
    const entries = await readdir(folderPath);
    return entries.some((name) => /^\d+[-_].+\.md$/i.test(name));
  } catch {
    return false;
  }
}

/* ─────────────────────────────────────────────────────────────
   Title derivation
   ───────────────────────────────────────────────────────────── */

/**
 * Derive a human-readable series title from the repo identifier.
 *
 * Examples:
 *   "iq-ai-lab/transformer-deep-dive" → "Transformer Deep Dive"
 *   "iq-dev-lab/redis-deep-dive"      → "Redis Deep Dive"
 */
export function deriveRepoTitle(source: string): string {
  const repoName = source.split('/').pop() ?? source;
  return repoName
  .split('-')
  .map((word) => word[0]?.toUpperCase() + word.slice(1))
  .join(' ');
}
