/**
 * iq-blogger — Converter Agent
 *
 * Takes a deep-dive markdown file and produces a blog-ready MDX file.
 *
 * Flow:
 *   1. Build system prompt from prompts/system.md + prompts/few-shot.md.
 *   2. Send source content to Claude.
 *   3. Validate output against hard constraints (validator.ts).
 *   4. On validation failure, send the issues back to Claude for correction.
 *      Retry up to IQ_BLOGGER_MAX_RETRIES times.
 *   5. Return success (with final MDX) or failure (with last issues).
 *
 * Why standard Anthropic SDK (not Claude Agent SDK):
 *   - Input = plain text, output = plain text. No tool use needed.
 *   - Deterministic retry control based on validator output.
 *   - Simpler cost/token accounting.
 *   - git-ops (separate module) will use Agent SDK if file/bash tools help.
 */

import Anthropic from '@anthropic-ai/sdk';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  MODEL_PRICING,
  type ConversionAttempt,
  type ConversionInput,
  type ConversionResult,
  type ParsedMdx,
} from './types';
import { formatIssuesForRetry, parseMdx, tryParseMdx, validate } from './validator';

/* ─────────────────────────────────────────────────────────────
   Configuration
   ───────────────────────────────────────────────────────────── */

export interface AgentConfig {
  /** Anthropic API key. Defaults to process.env.ANTHROPIC_API_KEY. */
  apiKey?: string;
  /** Model to use. Defaults to IQ_BLOGGER_MODEL env or 'claude-sonnet-4-6'. */
  model?: string;
  /** Max retries on validation failure. Defaults to IQ_BLOGGER_MAX_RETRIES or 3. */
  maxRetries?: number;
  /** Enable debug logging (dumps prompts + raw output). */
  debug?: boolean;
  /** Directory containing prompts/system.md and prompts/few-shot.md.
   *  Defaults to ../prompts relative to this file. */
  promptsDir?: string;
}

function resolveConfig(config: AgentConfig = {}): Required<AgentConfig> {
  const here = dirname(fileURLToPath(import.meta.url));
  return {
    apiKey: config.apiKey ?? process.env.ANTHROPIC_API_KEY ?? '',
    model: config.model ?? process.env.IQ_BLOGGER_MODEL ?? 'claude-sonnet-4-6',
    maxRetries: config.maxRetries ?? Number(process.env.IQ_BLOGGER_MAX_RETRIES ?? 3),
    debug: config.debug ?? process.env.IQ_BLOGGER_DEBUG === '1',
    promptsDir: config.promptsDir ?? resolve(here, '../prompts'),
  };
}

/* ─────────────────────────────────────────────────────────────
   Public API
   ───────────────────────────────────────────────────────────── */

/**
 * Convert one deep-dive markdown into a blog MDX post.
 *
 * Returns a tagged union:
 *   - { ok: true, mdx, slug, parsed, history, usage } on success.
 *   - { ok: false, issues, history, reason } on failure after retries.
 *
 * Never throws on "soft" failures (bad output, validation issues).
 * Throws only on infrastructure errors (missing API key, missing prompt files).
 */
export async function convert(input: ConversionInput, config: AgentConfig = {}): Promise<ConversionResult> {
  const cfg = resolveConfig(config);

  if (!cfg.apiKey) {
    throw new Error(
      'ANTHROPIC_API_KEY is required. Set it in the environment or pass { apiKey } to convert().',
    );
  }

  if (!(cfg.model in MODEL_PRICING)) {
    console.warn(
      `[iq-blogger] Warning: model "${cfg.model}" not in pricing table. Cost estimate will be 0.`,
    );
  }

  // Lazy-load prompts once per invocation (small I/O cost, keeps agent stateless).
  const { systemPrompt, fewShotPrompt } = await loadPrompts(cfg.promptsDir);

  const client = new Anthropic({ apiKey: cfg.apiKey });

  // Build the conversation history. On retry, we append validation issues
  // and the model's last attempt, then ask for a correction.
  const history: ConversionAttempt[] = [];
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  // Build initial user message.
  const initialUserMessage = buildInitialUserMessage(input, fewShotPrompt);

  // Messages accumulate across retries so Claude sees its own previous output
  // + the errors it needs to fix.
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: initialUserMessage }];

  for (let attempt = 1; attempt <= cfg.maxRetries + 1; attempt++) {
    if (cfg.debug) {
      console.error(`[iq-blogger] Attempt ${attempt}/${cfg.maxRetries + 1}`);
    }

    const response = await client.messages.create({
      model: cfg.model,
      max_tokens: 4096,
      system: systemPrompt,
      messages,
    });

    totalInputTokens += response.usage.input_tokens;
    totalOutputTokens += response.usage.output_tokens;

    const mdx = extractTextContent(response);
    const validation = validate(mdx);

    if (cfg.debug) {
      console.error(
        `[iq-blogger] Attempt ${attempt}: ${validation.ok ? 'PASS' : 'FAIL'} (${validation.metrics.wordCount} words, ${validation.metrics.h2Count} H2s, ${validation.issues.length} issues)`,
      );
    }

    history.push({ attempt, mdx, validation });

    // Check if model returned an ERROR sentinel (as per system.md).
    if (mdx.startsWith('ERROR:')) {
      return {
        ok: false,
        issues: [{ severity: 'error', rule: 'model-declined', message: mdx }],
        history,
        reason: `Model returned ERROR on attempt ${attempt}: ${mdx.slice(0, 200)}`,
      };
    }

    if (validation.ok) {
      // Success — parse for the slug and final structure.
      const parsed = parseMdx(mdx);
      const slug = slugFromTitle(parsed.frontmatter.title, input);
      return {
        ok: true,
        mdx,
        slug,
        parsed,
        history,
        usage: {
          inputTokens: totalInputTokens,
          outputTokens: totalOutputTokens,
          estimatedCostUsd: estimateCost(cfg.model, totalInputTokens, totalOutputTokens),
        },
      };
    }

    // Not last attempt? Add assistant response + feedback, retry.
    if (attempt <= cfg.maxRetries) {
      messages.push({ role: 'assistant', content: mdx });
      messages.push({ role: 'user', content: formatIssuesForRetry(validation.issues) });
    }
  }

  // All retries exhausted.
  const last = history[history.length - 1];
  if (!last) {
    // Defensive — should never happen since we always push at least once.
    return {
      ok: false,
      issues: [{ severity: 'error', rule: 'no-attempts', message: 'No conversion attempts were made.' }],
      history,
      reason: 'Agent did not produce any output.',
    };
  }

  return {
    ok: false,
    issues: last.validation.issues,
    history,
    reason: `Validation failed after ${history.length} attempts (${cfg.maxRetries} retries).`,
  };
}

/* ─────────────────────────────────────────────────────────────
   Prompt loading
   ───────────────────────────────────────────────────────────── */

interface LoadedPrompts {
  systemPrompt: string;
  fewShotPrompt: string;
}

async function loadPrompts(promptsDir: string): Promise<LoadedPrompts> {
  const systemPath = resolve(promptsDir, 'system.md');
  const fewShotPath = resolve(promptsDir, 'few-shot.md');

  try {
    const [systemPrompt, fewShotPrompt] = await Promise.all([
      readFile(systemPath, 'utf-8'),
      readFile(fewShotPath, 'utf-8'),
    ]);
    return { systemPrompt, fewShotPrompt };
  } catch (err) {
    throw new Error(
      `Failed to load prompts from ${promptsDir}: ${(err as Error).message}. ` +
        'Ensure prompts/system.md and prompts/few-shot.md exist.',
    );
  }
}

/* ─────────────────────────────────────────────────────────────
   Message construction
   ───────────────────────────────────────────────────────────── */

/**
 * Build the first user message — contains the input metadata, the few-shot
 * examples, and the source document.
 */
function buildInitialUserMessage(input: ConversionInput, fewShotPrompt: string): string {
  return [
    '# Few-shot examples',
    '',
    'Study these examples carefully. Your output must match their style.',
    '',
    fewShotPrompt,
    '',
    '---',
    '',
    '# Your task',
    '',
    'Convert the following deep-dive document into a blog MDX post.',
    'Follow all hard constraints in the system prompt.',
    'Return ONLY the MDX content (frontmatter + body). No code fences around it. No preamble.',
    '',
    '```',
    `SOURCE_REPO: ${input.sourceRepo}`,
    `SOURCE_PATH: ${input.sourcePath}`,
    `CHAPTER_ORDER: ${input.chapterOrder}`,
    `CHAPTER_TITLE: ${input.chapterTitle}`,
    `RUN_DATE: ${input.runDate}`,
    '```',
    '',
    '## Source document',
    '',
    input.content,
  ].join('\n');
}

/**
 * Extract plain text from Claude's response.
 * Model returns content blocks; we expect a single text block.
 */
function extractTextContent(response: Anthropic.Message): string {
  const textBlocks = response.content.filter((block): block is Anthropic.TextBlock => block.type === 'text');

  if (textBlocks.length === 0) {
    return 'ERROR: Model returned no text content.';
  }

  let text = textBlocks.map((b) => b.text).join('\n');

  // Defensive: model sometimes wraps output in ```mdx ... ``` despite
  // explicit instruction not to. Strip that.
  text = stripCodeFence(text);

  return text.trim();
}

/**
 * Remove a surrounding ``` / ```mdx / ```markdown fence if present.
 * Only strips fences that wrap the entire content.
 */
function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  // Match leading ```mdx or ```markdown or just ``` followed by newline,
  // and trailing ``` on its own line.
  const match = /^```(?:mdx|markdown|md)?\n([\s\S]*?)\n```$/.exec(trimmed);
  return match?.[1] ?? trimmed;
}

/* ─────────────────────────────────────────────────────────────
   Slug generation
   ───────────────────────────────────────────────────────────── */

/**
 * Derive the file slug for `src/content/posts/<slug>.mdx`.
 *
 * Strategy:
 *   1. Try to derive from the source path (stable, predictable).
 *   2. Fall back to title if source path yields nothing usable.
 *
 * Example:
 *   source: redis-deep-dive/redis-internals/01-single-thread-event-loop.md
 *   → slug: redis-single-thread-event-loop
 *
 * We prepend the repo's technology name (first word of repo) to disambiguate
 * across repos (e.g. mysql-single-thread vs redis-single-thread).
 */
export function slugFromTitle(_title: string, input: ConversionInput): string {
  // 1. Extract technology prefix from sourceRepo.
  //    "iq-dev-lab/redis-deep-dive" → "redis"
  //    "iq-ai-lab/transformer-deep-dive" → "transformer"
  const repoName = input.sourceRepo.split('/')[1] ?? '';
  const techPrefix = repoName.replace(/-deep-dive$/, '').replace(/-internals$/, '');

  // 2. Extract file basename without number prefix or extension.
  //    "redis-internals/01-single-thread-event-loop.md" → "single-thread-event-loop"
  const basename = input.sourcePath.split('/').pop() ?? '';
  const withoutExt = basename.replace(/\.md$/, '');
  const withoutNumber = withoutExt.replace(/^\d+[-_]/, '');

  // 3. Combine. Avoid duplicate prefix (e.g. "redis-redis-...").
  if (withoutNumber.startsWith(techPrefix + '-') || withoutNumber === techPrefix) {
    return withoutNumber;
  }
  return `${techPrefix}-${withoutNumber}`;
}

/* ─────────────────────────────────────────────────────────────
   Cost estimation
   ───────────────────────────────────────────────────────────── */

function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = MODEL_PRICING[model];
  if (!pricing) return 0;
  return (inputTokens / 1_000_000) * pricing.inputPerMTok + (outputTokens / 1_000_000) * pricing.outputPerMTok;
}

/* ─────────────────────────────────────────────────────────────
   Convenience: parse a single MDX string.
   Re-export so callers don't need to import validator directly.
   ───────────────────────────────────────────────────────────── */

export { parseMdx, tryParseMdx, validate } from './validator';
export type { ParsedMdx };
