/**
 * iq-blogger — Git Operations
 *
 * Manages source repo cloning and updates.
 *
 * Strategy:
 *   - Cache repos under .cache/sources/{org}/{repo}
 *   - On first access: git clone
 *   - On subsequent access: git fetch + reset (always sync to upstream)
 *   - Idempotent: running cloneOrPull twice is safe
 *
 * GitHub auth:
 *   - Public repos: no auth needed
 *   - GITHUB_TOKEN env var used if present (for rate limit / private repos)
 */

import { spawn } from 'node:child_process';
import { access, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';

/* ─────────────────────────────────────────────────────────────
   Public API
   ───────────────────────────────────────────────────────────── */

export interface CloneOptions {
  /** Repo identifier "org/repo", e.g. "iq-ai-lab/transformer-deep-dive". */
  source: string;
  /** Cache directory root. Default: ".cache/sources". */
  cacheDir?: string;
  /** GitHub token for private repos / rate limit. Default: env GITHUB_TOKEN. */
  token?: string;
  /** Force fresh clone (delete existing). Default: false. */
  force?: boolean;
}

export interface CloneResult {
  /** Absolute path to the cloned repo. */
  path: string;
  /** Action taken: 'cloned' (fresh) or 'pulled' (updated existing). */
  action: 'cloned' | 'pulled';
  /** Time taken in milliseconds. */
  durationMs: number;
}

/**
 * Clone a repo or pull updates if it already exists.
 * Returns the local filesystem path.
 */
export async function cloneOrPull(options: CloneOptions): Promise<CloneResult> {
  const cacheDir = options.cacheDir ?? '.cache/sources';
  const token = options.token ?? process.env.GITHUB_TOKEN;
  const repoPath = resolve(cacheDir, options.source);
  const startTime = Date.now();

  const exists = await dirExists(repoPath);

  // Force fresh clone — wipe existing
  if (exists && options.force) {
    await runCommand('rm', ['-rf', repoPath]);
  }

  if (!exists || options.force) {
    // Fresh clone
    await mkdir(dirname(repoPath), { recursive: true });
    const url = buildGitUrl(options.source, token);

    console.error(`[git-ops] Cloning ${options.source}...`);
    await runCommand('git', ['clone', '--depth=1', url, repoPath]);

    return {
      path: repoPath,
      action: 'cloned',
      durationMs: Date.now() - startTime,
    };
  }

  // Update existing
  console.error(`[git-ops] Updating ${options.source} (cache hit)...`);

  // Fetch latest, reset to upstream HEAD (handles force-pushed branches)
  await runCommand('git', ['-C', repoPath, 'fetch', 'origin'], { silent: true });

  // Get default branch name (main, master, etc.)
  const branch = await getDefaultBranch(repoPath);
  await runCommand('git', ['-C', repoPath, 'reset', '--hard', `origin/${branch}`], { silent: true });

  return {
    path: repoPath,
    action: 'pulled',
    durationMs: Date.now() - startTime,
  };
}

/**
 * Check if a repo is already cached locally.
 */
export async function isCached(source: string, cacheDir: string = '.cache/sources'): Promise<boolean> {
  const repoPath = resolve(cacheDir, source);
  return dirExists(repoPath);
}

/**
 * Get the local path for a source repo (whether cached or not).
 */
export function getCachedPath(source: string, cacheDir: string = '.cache/sources'): string {
  return resolve(cacheDir, source);
}

/* ─────────────────────────────────────────────────────────────
   Internal helpers
   ───────────────────────────────────────────────────────────── */

/**
 * Build the git clone URL.
 * If token is provided, use https with token (avoids rate limit, supports private repos).
 * Otherwise use plain https.
 */
function buildGitUrl(source: string, token?: string): string {
  if (token) {
    return `https://${token}@github.com/${source}.git`;
  }
  return `https://github.com/${source}.git`;
}

/**
 * Detect the default branch of a cloned repo (main, master, etc.).
 * Falls back to 'main' if detection fails.
 */
async function getDefaultBranch(repoPath: string): Promise<string> {
  try {
    const result = await runCommand(
        'git',
        ['-C', repoPath, 'symbolic-ref', '--short', 'HEAD'],
        { capture: true, silent: true },
    );
    return result.trim() || 'main';
  } catch {
    return 'main';
  }
}

/**
 * Check if a directory exists.
 */
async function dirExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Run a shell command. Returns stdout if capture is true.
 * Throws on non-zero exit code.
 */
interface CommandOptions {
  /** Capture stdout and return it. Default: false. */
  capture?: boolean;
  /** Suppress live output forwarding. Default: false. */
  silent?: boolean;
}

function runCommand(
    cmd: string,
    args: string[],
    options: CommandOptions = {},
): Promise<string> {
  return new Promise((resolveFn, rejectFn) => {
    const child = spawn(cmd, args, {
      stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : (options.silent ? 'ignore' : 'inherit'),
    });

    let stdout = '';
    let stderr = '';

    if (options.capture) {
      child.stdout?.on('data', (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr?.on('data', (chunk) => {
        stderr += chunk.toString();
      });
    }

    child.on('error', (err) => {
      rejectFn(new Error(`Failed to spawn "${cmd}": ${err.message}`));
    });

    child.on('exit', (code) => {
      if (code !== 0) {
        const detail = options.capture ? stderr.trim() : '';
        rejectFn(new Error(`${cmd} ${args.join(' ')} exited with code ${code}${detail ? ': ' + detail : ''}`));
      } else {
        resolveFn(stdout);
      }
    });
  });
}
