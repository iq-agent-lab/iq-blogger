/**
 * iq-blogger — Publisher
 *
 * Two operations:
 *   - deploy: drafts → blog → commit → push (publish to live)
 *   - revert: remove from blog → commit → push (retract published posts)
 *
 * Trust model: AI synthesis quality validated through manual review of
 * the first 8 posts. Deploy is automatic. If issues found post-deploy,
 * use revert to retract before pushing fixes.
 *
 * Frontmatter handling: drafts/ keeps `draft: true`. Publisher flips
 * to `draft: false` only when copying to the live blog repo.
 */

import { readdir, readFile, writeFile, access, unlink } from 'node:fs/promises';
import { resolve, basename } from 'node:path';
import { spawn } from 'node:child_process';

/* ─────────────────────────────────────────────────────────────
   Types
   ───────────────────────────────────────────────────────────── */

export interface DeployOptions {
  draftsDir?: string;
  targetPath: string;
  repo?: string;
  dryRun?: boolean;
  skipGit?: boolean;
}

export interface DeployResult {
  copied: string[];
  failed: { file: string; error: string }[];
  gitCommit?: string;
  gitPushed: boolean;
}

export interface RevertOptions {
  targetPath: string;
  repo?: string;
  slug?: string;
  dryRun?: boolean;
  skipGit?: boolean;
}

export interface RevertResult {
  removed: string[];
  failed: { file: string; error: string }[];
  gitCommit?: string;
  gitPushed: boolean;
}

/* ─────────────────────────────────────────────────────────────
   Deploy
   ───────────────────────────────────────────────────────────── */

export async function deploy(options: DeployOptions): Promise<DeployResult> {
  const draftsDir = options.draftsDir ?? './drafts';
  const targetDir = resolve(options.targetPath, 'src/content/posts');

  await verifyTargetExists(targetDir, options.targetPath);

  // For collision detection we need to know which other repos exist,
  // so always discover *all* drafts; the per-repo filter is applied
  // when deciding what to actually deploy.
  const allFiles = await discoverDraftFiles(draftsDir);
  const files = options.repo
      ? allFiles.filter((f) => f.repo === options.repo!.replace(/\//g, '-'))
      : allFiles;
  const result: DeployResult = { copied: [], failed: [], gitPushed: false };

  if (files.length === 0) return result;

  // Build a map of basename → repos that produce it. If >1, that name collides
  // and we must namespace it; otherwise keep the bare filename for backward compat.
  const collisionMap = new Map<string, Set<string>>();
  for (const f of allFiles) {
    const key = basename(f.path);
    if (!collisionMap.has(key)) collisionMap.set(key, new Set());
    collisionMap.get(key)!.add(f.repo);
  }

  // Copy + flip draft for each file
  for (const file of files) {
    const outName = resolveDeployedName(file, collisionMap);
    const targetFile = resolve(targetDir, outName);

    if (options.dryRun) {
      result.copied.push(`[dry-run] ${outName}`);
      continue;
    }

    try {
      const content = await readFile(file.path, 'utf-8');
      const flipped = flipDraftToFalse(content);
      await writeFile(targetFile, flipped, 'utf-8');
      result.copied.push(outName);
    } catch (err) {
      result.failed.push({
        file: outName,
        error: (err as Error).message,
      });
    }
  }

  if (result.failed.length > 0 || result.copied.length === 0) return result;
  if (options.skipGit || options.dryRun) return result;

  // Git operations
  const repoSlug = options.repo ?? 'multiple-repos';
  const commitMsg = `post: ${repoSlug} (${result.copied.length} post${result.copied.length === 1 ? '' : 's'})`;

  const pushed = await gitDeploy(options.targetPath, commitMsg);
  if (pushed) {
    result.gitCommit = commitMsg;
    result.gitPushed = true;
  }

  return result;
}

/* ─────────────────────────────────────────────────────────────
   Revert
   ───────────────────────────────────────────────────────────── */

export async function revert(options: RevertOptions): Promise<RevertResult> {
  const targetDir = resolve(options.targetPath, 'src/content/posts');

  await verifyTargetExists(targetDir, options.targetPath);

  const filesToRemove = await discoverPublishedFiles(targetDir, options);
  const result: RevertResult = { removed: [], failed: [], gitPushed: false };

  if (filesToRemove.length === 0) return result;

  for (const file of filesToRemove) {
    if (options.dryRun) {
      result.removed.push(`[dry-run] ${basename(file)}`);
      continue;
    }

    try {
      await unlink(file);
      result.removed.push(basename(file));
    } catch (err) {
      result.failed.push({
        file: basename(file),
        error: (err as Error).message,
      });
    }
  }

  if (result.failed.length > 0 || result.removed.length === 0) return result;
  if (options.skipGit || options.dryRun) return result;

  // Git operations
  const target = options.repo ?? options.slug ?? 'multiple-posts';
  const commitMsg = `revert: ${target} (${result.removed.length} post${result.removed.length === 1 ? '' : 's'})`;

  const pushed = await gitDeploy(options.targetPath, commitMsg);
  if (pushed) {
    result.gitCommit = commitMsg;
    result.gitPushed = true;
  }

  return result;
}

/* ─────────────────────────────────────────────────────────────
   File discovery
   ───────────────────────────────────────────────────────────── */

interface DraftFile {
  path: string;
  repo: string;
}

async function discoverDraftFiles(draftsDir: string, repo?: string): Promise<DraftFile[]> {
  const files: DraftFile[] = [];
  const repoSlug = repo?.replace(/\//g, '-');

  let entries: string[];
  try {
    entries = await readdir(draftsDir);
  } catch {
    return [];
  }

  const fs = await import('node:fs/promises');

  for (const entry of entries) {
    const entryPath = resolve(draftsDir, entry);
    const stat = await fs.stat(entryPath);
    if (!stat.isDirectory()) continue;
    if (repoSlug && entry !== repoSlug) continue;

    const dirFiles = await readdir(entryPath);
    for (const filename of dirFiles) {
      if (!filename.endsWith('.mdx')) continue;
      files.push({
        path: resolve(entryPath, filename),
        repo: entry,
      });
    }
  }

  return files;
}

async function discoverPublishedFiles(
    postsDir: string,
    options: RevertOptions,
): Promise<string[]> {
  const allFiles = await readdir(postsDir);
  const mdxFiles = allFiles.filter((f) => f.endsWith('.mdx'));

  // If --slug specified, match exactly
  if (options.slug) {
    const target = options.slug.endsWith('.mdx') ? options.slug : `${options.slug}.mdx`;
    return mdxFiles.includes(target) ? [resolve(postsDir, target)] : [];
  }

  // If --repo specified, find files that match by checking drafts/
  // (we know which slugs were generated from which repo via drafts/)
  if (options.repo) {
    const repoSlug = options.repo.replace(/\//g, '-');
    const draftsRepoDir = resolve('./drafts', repoSlug);

    let draftFiles: string[];
    try {
      draftFiles = await readdir(draftsRepoDir);
    } catch {
      return [];
    }

    // Build collision map across ALL drafts, mirroring deploy logic
    const allDrafts = await discoverDraftFiles('./drafts');
    const collisionMap = new Map<string, Set<string>>();
    for (const f of allDrafts) {
      const key = basename(f.path);
      if (!collisionMap.has(key)) collisionMap.set(key, new Set());
      collisionMap.get(key)!.add(f.repo);
    }

    const candidates = draftFiles
        .filter((f) => f.endsWith('.mdx'))
        .map((f) =>
            resolveDeployedName(
                { path: resolve(draftsRepoDir, f), repo: repoSlug },
                collisionMap,
            ),
        );
    return candidates
        .filter((slug) => mdxFiles.includes(slug))
        .map((slug) => resolve(postsDir, slug));
  }

  return [];
}

/* ─────────────────────────────────────────────────────────────
   Filename collision handling
   ───────────────────────────────────────────────────────────── */

/**
 * Derive a stable per-file name when basenames collide across repos.
 *
 * Most basenames are unique → return as-is (backward compatible).
 * If two or more repos produce the same basename, append a repo-suffix:
 *   ch7-frontier.mdx (3 repos) → ch7-frontier-llm-reasoning.mdx
 *
 * The suffix is the last meaningful segment of the repo name with `-deep-dive`
 * stripped. Stable across runs; deploy and revert both call this.
 */
export function resolveDeployedName(
    file: DraftFile,
    collisionMap: Map<string, Set<string>>,
): string {
  const name = basename(file.path);
  const owners = collisionMap.get(name);
  if (!owners || owners.size <= 1) return name;

  const suffix = repoSuffix(file.repo);
  const ext = name.endsWith('.mdx') ? '.mdx' : '';
  const stem = ext ? name.slice(0, -ext.length) : name;
  return `${stem}-${suffix}${ext}`;
}

/** "iq-ai-lab-llm-reasoning-deep-dive" → "llm-reasoning". */
function repoSuffix(repoSlug: string): string {
  // Strip org prefix (everything up to and including the first hyphen-lab-)
  const afterOrg = repoSlug.replace(/^iq-(?:ai|dev)-lab-/, '');
  // Strip trailing -deep-dive (most repos)
  return afterOrg.replace(/-deep-dive$/, '');
}

/* ─────────────────────────────────────────────────────────────
   Frontmatter manipulation
   ───────────────────────────────────────────────────────────── */

function flipDraftToFalse(content: string): string {
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!frontmatterMatch) return content;

  const frontmatter = frontmatterMatch[1] ?? '';
  const flippedFrontmatter = frontmatter.replace(/^draft:\s*true\s*$/m, 'draft: false');

  return content.replace(frontmatterMatch[0], `---\n${flippedFrontmatter}\n---`);
}

/* ─────────────────────────────────────────────────────────────
   Git operations
   ───────────────────────────────────────────────────────────── */

async function gitDeploy(repoPath: string, commitMsg: string): Promise<boolean> {
  await runCommand('git', ['-C', repoPath, 'add', 'src/content/posts/'], false);

  // Check if there's anything staged before committing
  const hasChanges = await hasStagedChanges(repoPath);
  if (!hasChanges) {
    console.error(`[publisher] ⚠️  No changes to commit (already up to date)`);
    return false;
  }

  await runCommand('git', ['-C', repoPath, 'commit', '-m', commitMsg], false);
  console.error(`[publisher] Pushing to GitHub...`);
  await runCommand('git', ['-C', repoPath, 'push'], false);
  return true;
}

/**
 * Check if there are staged changes ready to commit.
 * Uses `git diff --cached --quiet` which exits 0 (no changes) or 1 (changes).
 */
async function hasStagedChanges(repoPath: string): Promise<boolean> {
  return new Promise((resolveFn) => {
    const child = spawn('git', ['-C', repoPath, 'diff', '--cached', '--quiet'], {
      stdio: 'ignore',
    });
    child.on('exit', (code) => {
      // exit 0 = no changes, exit 1 = changes exist
      resolveFn(code !== 0);
    });
    child.on('error', () => resolveFn(false));
  });
}

function runCommand(cmd: string, args: string[], silent: boolean): Promise<void> {
  return new Promise((resolveFn, rejectFn) => {
    const child = spawn(cmd, args, {
      stdio: silent ? 'ignore' : 'inherit',
    });

    child.on('error', (err) => {
      rejectFn(new Error(`Failed to spawn "${cmd}": ${err.message}`));
    });

    child.on('exit', (code) => {
      if (code !== 0) {
        rejectFn(new Error(`${cmd} ${args.join(' ')} exited with code ${code}`));
      } else {
        resolveFn();
      }
    });
  });
}

/* ─────────────────────────────────────────────────────────────
   Helpers
   ───────────────────────────────────────────────────────────── */

async function verifyTargetExists(targetDir: string, targetPath: string): Promise<void> {
  try {
    await access(targetDir);
  } catch {
    throw new Error(
        `Target posts directory not found: ${targetDir}\n` +
        `Make sure ${targetPath} is the blog repo root containing src/content/posts/.`,
    );
  }
}
