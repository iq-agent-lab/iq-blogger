/**
 * iq-blogger — Progress Tracker
 *
 * Tracks conversion progress across repos and folders.
 * Stored as drafts/progress.json (gitignored).
 *
 * Status states:
 *   - "pending"     : not started
 *   - "in-progress" : conversion attempt running (rare; mostly transient)
 *   - "done"        : successfully converted
 *   - "failed"      : conversion failed after all retries
 *   - "skipped"     : intentionally skipped (e.g. README)
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

/* ─────────────────────────────────────────────────────────────
   Types
   ───────────────────────────────────────────────────────────── */

export type FolderStatus = 'pending' | 'in-progress' | 'done' | 'failed';

export interface FolderRecord {
  /** Display title (e.g. "Redis Internals"). */
  title: string;
  /** Current status. */
  status: FolderStatus;
  /** Number of source chapters in this folder. */
  chaptersTotal: number;
  /** Output slug (filename without extension), set when done. */
  outputSlug?: string;
  /** Number of conversion attempts (1-4 typically). */
  attempts?: number;
  /** Estimated cost in USD. */
  cost?: number;
  /** Word count of generated post. */
  wordCount?: number;
  /** Validation warnings (non-blocking issues). */
  warnings?: string[];
  /** Failure reason if status === 'failed'. */
  lastError?: string;
  /** ISO timestamp. */
  completedAt?: string;
  /** ISO timestamp. */
  lastAttemptAt?: string;
}

export interface RepoRecord {
  /** Folder name → record. */
  folders: Record<string, FolderRecord>;
}

export interface Progress {
  /** Schema version for future migrations. */
  version: number;
  /** ISO timestamp of last update. */
  lastUpdated: string;
  /** Repo full name (e.g. "iq-dev-lab/redis-deep-dive") → record. */
  repos: Record<string, RepoRecord>;
}

/* ─────────────────────────────────────────────────────────────
   Load / Save
   ───────────────────────────────────────────────────────────── */

/**
 * Load progress from disk. Returns empty progress if file doesn't exist.
 */
export async function loadProgress(filePath: string): Promise<Progress> {
  try {
    const content = await readFile(filePath, 'utf-8');
    const parsed = JSON.parse(content) as Progress;

    // Defensive: ensure shape is valid.
    if (typeof parsed.version !== 'number' || !parsed.repos) {
      throw new Error('Invalid progress file shape');
    }
    return parsed;
  } catch (err) {
    // File doesn't exist or is malformed — start fresh.
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return emptyProgress();
    }
    // Malformed JSON — log and start fresh (don't lose data unnecessarily).
    console.warn(`[progress] Could not parse ${filePath}, starting fresh: ${(err as Error).message}`);
    return emptyProgress();
  }
}

/**
 * Save progress to disk. Creates parent directories as needed.
 */
export async function saveProgress(filePath: string, progress: Progress): Promise<void> {
  progress.lastUpdated = new Date().toISOString();
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(progress, null, 2), 'utf-8');
}

function emptyProgress(): Progress {
  return {
    version: 1,
    lastUpdated: new Date().toISOString(),
    repos: {},
  };
}

/* ─────────────────────────────────────────────────────────────
   Folder updates
   ───────────────────────────────────────────────────────────── */

export interface FolderInit {
  repo: string;
  folder: string;
  title: string;
  chaptersTotal: number;
}

/**
 * Initialize a folder record (status: pending) if it doesn't exist.
 * Idempotent — won't overwrite existing record.
 */
export function ensureFolder(progress: Progress, init: FolderInit): void {
  const repo = ensureRepo(progress, init.repo);
  if (!repo.folders[init.folder]) {
    repo.folders[init.folder] = {
      title: init.title,
      status: 'pending',
      chaptersTotal: init.chaptersTotal,
    };
  }
}

/** Mark folder as in-progress (conversion starting). */
export function markFolderStarted(progress: Progress, repo: string, folder: string): void {
  const record = getFolderRecord(progress, repo, folder);
  if (!record) return;
  record.status = 'in-progress';
  record.lastAttemptAt = new Date().toISOString();
}

export interface FolderDoneInfo {
  outputSlug: string;
  attempts: number;
  cost: number;
  wordCount: number;
  warnings?: string[];
}

export function markFolderDone(
    progress: Progress,
    repo: string,
    folder: string,
    info: FolderDoneInfo,
): void {
  const record = getFolderRecord(progress, repo, folder);
  if (!record) return;
  record.status = 'done';
  record.outputSlug = info.outputSlug;
  record.attempts = info.attempts;
  record.cost = info.cost;
  record.wordCount = info.wordCount;
  record.warnings = info.warnings;
  record.completedAt = new Date().toISOString();
}

export function markFolderFailed(
    progress: Progress,
    repo: string,
    folder: string,
    error: string,
    attempts: number,
): void {
  const record = getFolderRecord(progress, repo, folder);
  if (!record) return;
  record.status = 'failed';
  record.lastError = error;
  record.attempts = attempts;
  record.lastAttemptAt = new Date().toISOString();
}

/* ─────────────────────────────────────────────────────────────
   Queries
   ───────────────────────────────────────────────────────────── */

/** Check whether a folder has been successfully converted. */
export function isFolderDone(progress: Progress, repo: string, folder: string): boolean {
  return getFolderRecord(progress, repo, folder)?.status === 'done';
}

/** Check whether a folder previously failed. */
export function isFolderFailed(progress: Progress, repo: string, folder: string): boolean {
  return getFolderRecord(progress, repo, folder)?.status === 'failed';
}

export function getFolderRecord(
    progress: Progress,
    repo: string,
    folder: string,
): FolderRecord | undefined {
  return progress.repos[repo]?.folders[folder];
}

/* ─────────────────────────────────────────────────────────────
   Status report — pretty CLI output
   ───────────────────────────────────────────────────────────── */

export interface StatusSummary {
  totalFolders: number;
  done: number;
  failed: number;
  inProgress: number;
  pending: number;
  totalCost: number;
}

export function computeSummary(progress: Progress): StatusSummary {
  const summary: StatusSummary = {
    totalFolders: 0,
    done: 0,
    failed: 0,
    inProgress: 0,
    pending: 0,
    totalCost: 0,
  };

  for (const repo of Object.values(progress.repos)) {
    for (const folder of Object.values(repo.folders)) {
      summary.totalFolders++;
      summary.totalCost += folder.cost ?? 0;
      switch (folder.status) {
        case 'done':
          summary.done++;
          break;
        case 'failed':
          summary.failed++;
          break;
        case 'in-progress':
          summary.inProgress++;
          break;
        case 'pending':
          summary.pending++;
          break;
      }
    }
  }

  return summary;
}

const STATUS_ICONS: Record<FolderStatus, string> = {
  done: '✅',
  failed: '❌',
  'in-progress': '🚧',
  pending: '⬜',
};

/**
 * Format progress as a human-readable report for CLI display.
 */
export function formatStatusReport(progress: Progress): string {
  const lines: string[] = [];
  lines.push('📊 iq-blogger Progress Report');
  lines.push('');

  const repoNames = Object.keys(progress.repos).sort();
  if (repoNames.length === 0) {
    lines.push('  No conversions yet. Run `convert-folder` to start.');
    lines.push('');
    return lines.join('\n');
  }

  for (const repoName of repoNames) {
    const repo = progress.repos[repoName];
    if (!repo) continue;

    lines.push(repoName);

    const folderNames = Object.keys(repo.folders).sort();
    for (const folderName of folderNames) {
      const folder = repo.folders[folderName];
      if (!folder) continue;

      const icon = STATUS_ICONS[folder.status];
      let line = `  ${icon} ${folderName}`;

      if (folder.status === 'done') {
        const cost = folder.cost?.toFixed(2) ?? '?.??';
        const attempts = folder.attempts ?? '?';
        const wc = folder.wordCount ?? '?';
        line += `  (${wc}w, ${attempts} attempt${attempts === 1 ? '' : 's'}, $${cost})`;
      } else if (folder.status === 'failed') {
        line += `  (failed: ${folder.lastError ?? 'unknown'})`;
      } else if (folder.status === 'in-progress') {
        line += `  (in progress)`;
      } else {
        line += `  (pending, ${folder.chaptersTotal} chapters)`;
      }

      lines.push(line);
    }
    lines.push('');
  }

  // Summary
  const s = computeSummary(progress);
  lines.push('Summary:');
  lines.push(`  ✅ Done:        ${s.done}`);
  lines.push(`  ❌ Failed:      ${s.failed}`);
  if (s.inProgress > 0) lines.push(`  🚧 In progress: ${s.inProgress}`);
  lines.push(`  ⬜ Pending:     ${s.pending}`);
  lines.push(`  Total folders:  ${s.totalFolders}`);
  lines.push(`  Total cost:     $${s.totalCost.toFixed(2)}`);
  lines.push('');

  return lines.join('\n');
}

/* ─────────────────────────────────────────────────────────────
   Helpers
   ───────────────────────────────────────────────────────────── */

function ensureRepo(progress: Progress, repoName: string): RepoRecord {
  if (!progress.repos[repoName]) {
    progress.repos[repoName] = { folders: {} };
  }
  return progress.repos[repoName] as RepoRecord;
}
