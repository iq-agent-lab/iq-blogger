/**
 * iq-blogger — Core Types
 *
 * Type contracts shared between agent, validator, and (later) git-ops.
 * Source of truth for the input/output shapes.
 *
 * * IMPORTANT: FrontmatterSchema MUST mirror iq-agent-lab/iq-blogger 레포의 형제 레포인
 * *            iq-proof.github.io/src/content.config.ts.
 * If the blog schema changes, update here too.
 */

import { z } from 'zod';

/* ─────────────────────────────────────────────────────────────
   Input to the agent — one deep-dive chapter to convert.
   ───────────────────────────────────────────────────────────── */

export interface ConversionInput {
  /** e.g. "iq-dev-lab/redis-deep-dive" */
  sourceRepo: string;
  /** e.g. "redis-internals/01-single-thread-event-loop.md" */
  sourcePath: string;
  /** Chapter order within the series, e.g. 1 */
  chapterOrder: number;
  /** Human-readable series title, e.g. "Redis Internals" */
  chapterTitle: string;
  /** ISO date (YYYY-MM-DD) the post should be published */
  runDate: string;
  /** Full file contents of the source markdown */
  content: string;
}

/* ─────────────────────────────────────────────────────────────
   Output — MIRRORS iq-proof/src/content.config.ts.
   Any divergence will cause post rejection at build time.
   ───────────────────────────────────────────────────────────── */

export const CategoryEnum = z.enum(['dev', 'ai', 'agent']);
export const DifficultyEnum = z.enum(['beginner', 'intermediate', 'advanced']);

export const SeriesSchema = z.object({
  slug: z.string(),
  title: z.string(),
  order: z.number().int().positive(),
});

/**
 * Blog post frontmatter schema.
 *
 * Note: pubDate uses z.coerce.date() to match blog behavior.
 * YAML parsers (including gray-matter) auto-convert ISO dates to JS Date
 * objects, so we accept both a Date and an ISO string.
 */
export const FrontmatterSchema = z.object({
  title: z.string().min(1).max(120),
  description: z.string().min(1).max(240),

  // Accept both Date (from YAML auto-parse) and string (defensive).
  // z.coerce.date() handles both: Date → passes through, string → parses.
  pubDate: z.coerce.date(),
  updatedDate: z.coerce.date().optional(),

  category: CategoryEnum,

  // Tags are free-form (no regex, no min/max count).
  // We enforce 3-5 kebab-case tags in the *agent prompt*, not the schema,
  // because the schema must accept what the blog accepts.
  tags: z.array(z.string()).default([]),

  series: SeriesSchema.optional(),
  difficulty: DifficultyEnum.optional(),
  heroImage: z.string().optional(),
  heroAlt: z.string().optional(),
  draft: z.boolean().default(false),
  featured: z.boolean().default(false),
});

export type Frontmatter = z.infer<typeof FrontmatterSchema>;

/* ─────────────────────────────────────────────────────────────
   Parsed MDX file — splits frontmatter from body.
   ───────────────────────────────────────────────────────────── */

export interface ParsedMdx {
  /** The YAML frontmatter, parsed and typed. */
  frontmatter: Frontmatter;
  /** Everything after the `---` closing fence (imports + body). */
  body: string;
  /** Raw MDX file content (frontmatter + body concatenated). */
  raw: string;
}

/* ─────────────────────────────────────────────────────────────
   Validator output.
   ───────────────────────────────────────────────────────────── */

export type ValidationSeverity = 'error' | 'warning';

export interface ValidationIssue {
  /** 'error' blocks the post from being published; 'warning' is advisory. */
  severity: ValidationSeverity;
  /** Short stable identifier for the rule that fired, e.g. 'word-count'. */
  rule: string;
  /** Human-readable explanation with specifics (e.g. "found 412, expected 270-330"). */
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
  metrics: {
    wordCount: number;
    h2Count: number;
    codeBlockCount: number;
    mathBlockCount: number;
    mdxComponentCount: number;
  };
}

/* ─────────────────────────────────────────────────────────────
   Agent output.
   ───────────────────────────────────────────────────────────── */

export interface ConversionAttempt {
  attempt: number;
  mdx: string;
  validation: ValidationResult;
}

export type ConversionResult =
    | {
  ok: true;
  /** Final MDX content (frontmatter + body), ready to write to disk. */
  mdx: string;
  /** Filename to save as — `${slug}.mdx` (kebab-case, no extension path). */
  slug: string;
  /** Parsed form for programmatic access (e.g. git commit messages). */
  parsed: ParsedMdx;
  /** All attempts including successful final one. Useful for debugging. */
  history: ConversionAttempt[];
  /** Token usage summary across all attempts. */
  usage: {
    inputTokens: number;
    outputTokens: number;
    estimatedCostUsd: number;
  };
}
    | {
  ok: false;
  /** Last attempt's validation issues. */
  issues: ValidationIssue[];
  /** All attempts made. */
  history: ConversionAttempt[];
  /** Reason for final failure. */
  reason: string;
};

/* ─────────────────────────────────────────────────────────────
   Hard constraints — single source of truth for validator rules.
   Matches prompts/system.md hard constraints.
   ───────────────────────────────────────────────────────────── */

export const HARD_CONSTRAINTS = {
  /**
   * Word count for SYNTHESIS posts (5-7 chapters → 1 post).
   * Wider range: synthesis needs room for cross-chapter pattern extraction.
   */
  wordCount: {
    min: 500,         // hard error: below = couldn't synthesize 5-7 chapters
    max: 2000,        // hard error: above = bloated even for synthesis
    warningMin: 700,  // warning: probably too compressed for synthesis
    warningMax: 1500, // warning: getting long
    target: 1000,     // prompt guidance target
  },

  /** 1 chapter posts: 5-7 H2 sections (last must be "정리"). */
  h2Count: { min: 5, max: 7 },

  /** Intro must exist (text before first H2). 2-4 sentences ideal, 5 OK. */
  introMinSentences: 2,
  introMaxSentences: 5, // synthesis posts may need slightly longer intro

  /** Last H2 must be exactly `## 정리`. */
  lastH2Title: '정리',

  /** Tags: 3-5 items, each kebab-case. Enforced by validator, not frontmatter schema. */
  tagsMinCount: 3,
  tagsMaxCount: 5,
  tagPattern: /^[a-z0-9-]+$/,

  /** Words that leak teacher-ese tone and must not appear in output. */
  forbiddenPolitePhrases: ['합니다.', '입니다.', '습니다.', '합니다,', '입니다,', '습니다,', '하세요', '까요?'],

  /** Emojis forbidden in H1/H2 titles (allowed in body). */
  forbiddenTitleEmojis: ['🎯', '🔍', '😱', '✨', '🔬', '💻', '📊', '⚖️', '📌', '🤔'],

  /** Deep-dive sections that must be dropped entirely. */
  mustDropSections: ['💻 실전 실험', '🤔 생각해볼 문제'],
} as const;

/* ─────────────────────────────────────────────────────────────
   Model pricing — for cost estimation.
   Updated 2026-04. Check https://www.anthropic.com/pricing for current rates.
   ───────────────────────────────────────────────────────────── */

export const MODEL_PRICING: Record<string, { inputPerMTok: number; outputPerMTok: number }> = {
  'claude-opus-4-7': { inputPerMTok: 15, outputPerMTok: 75 },
  'claude-sonnet-4-6': { inputPerMTok: 3, outputPerMTok: 15 },
  'claude-haiku-4-5-20251001': { inputPerMTok: 1, outputPerMTok: 5 },
};
