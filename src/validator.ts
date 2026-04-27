/**
 * iq-blogger — Validator
 *
 * Verifies that agent output conforms to the blog's hard constraints.
 * All rules mirror `prompts/system.md` Hard Constraints section.
 *
 * Philosophy: fail fast, specific error messages. The agent uses validator
 * output verbatim as feedback for the retry loop — vague errors produce
 * vague fixes.
 */

import matter from 'gray-matter';
import { ZodError } from 'zod';
import {
  FrontmatterSchema,
  HARD_CONSTRAINTS,
  type Frontmatter,
  type ParsedMdx,
  type ValidationIssue,
  type ValidationResult,
} from './types.js';

/* ─────────────────────────────────────────────────────────────
   Public API
   ───────────────────────────────────────────────────────────── */

/**
 * Parse raw MDX (frontmatter + body) into typed components.
 * Throws if frontmatter YAML is malformed or fails Zod validation.
 */
export function parseMdx(raw: string): ParsedMdx {
  const parsed = matter(raw);

  // Zod validation — fails loudly with field-level errors.
  const frontmatter = FrontmatterSchema.parse(parsed.data) as Frontmatter;

  return {
    frontmatter,
    body: parsed.content,
    raw,
  };
}

/**
 * Try to parse MDX. Returns either a parsed result or detailed issues
 * (useful for validator to surface frontmatter errors as issues rather
 * than crashing).
 */
export function tryParseMdx(raw: string): { ok: true; parsed: ParsedMdx } | { ok: false; issues: ValidationIssue[] } {
  try {
    const parsed = parseMdx(raw);
    return { ok: true, parsed };
  } catch (err) {
    if (err instanceof ZodError) {
      return {
        ok: false,
        issues: err.issues.map((issue) => ({
          severity: 'error',
          rule: 'frontmatter-schema',
          message: `Frontmatter field "${issue.path.join('.')}" — ${issue.message}`,
        })),
      };
    }
    return {
      ok: false,
      issues: [
        {
          severity: 'error',
          rule: 'frontmatter-parse',
          message: `Failed to parse frontmatter: ${(err as Error).message}`,
        },
      ],
    };
  }
}

/**
 * Main validation entry point.
 *
 * Runs all hard-constraint checks and produces a structured result.
 * - `ok: true` means zero errors (warnings are OK).
 * - `ok: false` means at least one error — agent should retry.
 */
export function validate(raw: string): ValidationResult {
  const parseResult = tryParseMdx(raw);

  // Frontmatter couldn't even be parsed — return early with parse issues
  // and zero metrics.
  if (!parseResult.ok) {
    return {
      ok: false,
      issues: parseResult.issues,
      metrics: { wordCount: 0, h2Count: 0, codeBlockCount: 0, mathBlockCount: 0, mdxComponentCount: 0 },
    };
  }

  const { parsed } = parseResult;
  const issues: ValidationIssue[] = [];

  // Run all checks. Each returns ValidationIssue[] (may be empty).
  issues.push(...checkWordCount(parsed));
  issues.push(...checkH2Structure(parsed));
  issues.push(...checkIntro(parsed));
  issues.push(...checkTags(parsed));
  issues.push(...checkPoliteTone(parsed));
  issues.push(...checkTitleEmojis(parsed));
  issues.push(...checkDroppedSections(parsed));
  issues.push(...checkDraftFlag(parsed));
  issues.push(...checkFeaturedFlag(parsed));
  issues.push(...checkMdxImports(parsed));
  issues.push(...checkCodeBlockLangTags(parsed));
  issues.push(...checkMathBlockSpacing(parsed));

  const metrics = computeMetrics(parsed);
  const hasErrors = issues.some((i) => i.severity === 'error');

  return { ok: !hasErrors, issues, metrics };
}

/* ─────────────────────────────────────────────────────────────
   Check helpers — one per hard constraint.
   Each returns [] on success, or [issue, ...] on failure.
   ───────────────────────────────────────────────────────────── */

/**
 * Hard constraint 1: word count.
 * - Hard error: outside [min, max] — clearly broken.
 * - Warning: outside [warningMin, warningMax] — passable but flag for review.
 */
function checkWordCount(parsed: ParsedMdx): ValidationIssue[] {
  const count = countWords(stripMdx(parsed.body));
  const { min, max, warningMin, warningMax } = HARD_CONSTRAINTS.wordCount;

  // Hard error tier — block and retry
  if (count < min) {
    return [{
      severity: 'error',
      rule: 'word-count',
      message: `Found ${count} words, hard minimum is ${min}. 본문이 너무 짧아 의미 전달 부족. 더 풀어써라.`,
    }];
  }
  if (count > max) {
    return [{
      severity: 'error',
      rule: 'word-count',
      message: `Found ${count} words, hard maximum is ${max}. 본문이 너무 길어 핵심이 흐려진다. 압축하라.`,
    }];
  }

  // Warning tier — pass but flag
  if (count < warningMin) {
    return [{
      severity: 'warning',
      rule: 'word-count-short',
      message: `Found ${count} words, recommended ${warningMin}-${warningMax}. 권장 범위보다 짧음 (통과는 가능).`,
    }];
  }
  if (count > warningMax) {
    return [{
      severity: 'warning',
      rule: 'word-count-long',
      message: `Found ${count} words, recommended ${warningMin}-${warningMax}. 권장 범위보다 김 (통과는 가능).`,
    }];
  }

  return [];
}

/** Hard constraint 2: 5-7 H2 sections, last one titled "정리". */
function checkH2Structure(parsed: ParsedMdx): ValidationIssue[] {
  const h2s = extractH2Titles(parsed.body);
  const { min, max } = HARD_CONSTRAINTS.h2Count;
  const issues: ValidationIssue[] = [];

  if (h2s.length < min || h2s.length > max) {
    issues.push({
      severity: 'error',
      rule: 'h2-count',
      message: `Found ${h2s.length} H2 sections, expected ${min}-${max}. ${
          h2s.length > 0 ? `Current: ${h2s.map((t) => `"${t}"`).join(', ')}` : ''
      }`,
    });
  }

  const last = h2s[h2s.length - 1];
  if (last !== undefined && last !== HARD_CONSTRAINTS.lastH2Title) {
    issues.push({
      severity: 'error',
      rule: 'last-h2-title',
      message: `Last H2 must be exactly "## ${HARD_CONSTRAINTS.lastH2Title}", found "## ${last}".`,
    });
  }

  return issues;
}

/** Hard constraint 3: intro exists (2-3 sentences before first H2). */
function checkIntro(parsed: ParsedMdx): ValidationIssue[] {
  const intro = extractIntro(parsed.body);
  if (!intro || intro.trim().length === 0) {
    return [
      {
        severity: 'error',
        rule: 'missing-intro',
        message: 'No intro found before the first H2. Blog posts must open with 2-3 sentences without a heading.',
      },
    ];
  }

  const sentences = countSentences(intro);
  const { introMinSentences, introMaxSentences } = HARD_CONSTRAINTS;

  if (sentences < introMinSentences) {
    return [
      {
        severity: 'error',
        rule: 'intro-too-short',
        message: `Intro has ${sentences} sentences, need at least ${introMinSentences}.`,
      },
    ];
  }

  if (sentences > introMaxSentences) {
    return [
      {
        severity: 'warning',
        rule: 'intro-too-long',
        message: `Intro has ${sentences} sentences, target is 2-3.`,
      },
    ];
  }

  return [];
}

/**
 * Tag constraints enforced by validator (not by FrontmatterSchema).
 *
 * Why here and not in the schema:
 *   - Blog's content.config.ts accepts any string[] for tags.
 *   - We want to enforce kebab-case + count for consistency across posts,
 *     but not so strictly that blog build would reject them.
 *   - Keeping it in the validator means: agent can self-correct via retry,
 *     but a human can override by committing directly if they want.
 */
function checkTags(parsed: ParsedMdx): ValidationIssue[] {
  const tags = parsed.frontmatter.tags;
  const { tagsMinCount, tagsMaxCount, tagPattern } = HARD_CONSTRAINTS;
  const issues: ValidationIssue[] = [];

  if (tags.length < tagsMinCount || tags.length > tagsMaxCount) {
    issues.push({
      severity: 'error',
      rule: 'tag-count',
      message: `Found ${tags.length} tags, expected ${tagsMinCount}-${tagsMaxCount}.`,
    });
  }

  const invalid = tags.filter((t) => !tagPattern.test(t));
  if (invalid.length > 0) {
    issues.push({
      severity: 'error',
      rule: 'tag-format',
      message: `Tags must be lowercase kebab-case. Invalid: ${invalid.map((t) => `"${t}"`).join(', ')}.`,
    });
  }

  return issues;
}

/** Hard constraint 5: no 경어체 (합니다/입니다 etc.) in body. */
function checkPoliteTone(parsed: ParsedMdx): ValidationIssue[] {
  const body = stripMdxImports(parsed.body);
  const hits: string[] = [];

  for (const phrase of HARD_CONSTRAINTS.forbiddenPolitePhrases) {
    if (body.includes(phrase)) {
      hits.push(phrase);
    }
  }

  if (hits.length > 0) {
    return [
      {
        severity: 'error',
        rule: 'polite-tone',
        message: `Found 경어체 phrases: ${hits.map((h) => `"${h}"`).join(', ')}. Convert to 평서체 (~한다, ~이다).`,
      },
    ];
  }
  return [];
}

/** Hard constraint 4: no template emojis in H1/H2 titles. */
function checkTitleEmojis(parsed: ParsedMdx): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const titles = [parsed.frontmatter.title, ...extractH2Titles(parsed.body)];

  for (const title of titles) {
    for (const emoji of HARD_CONSTRAINTS.forbiddenTitleEmojis) {
      if (title.includes(emoji)) {
        issues.push({
          severity: 'error',
          rule: 'title-emoji',
          message: `Title/H2 "${title}" contains forbidden emoji "${emoji}". Remove all template emojis from headings.`,
        });
        break; // one issue per title is enough
      }
    }
  }
  return issues;
}

/** Hard constraint 7: must-drop sections must not appear as H2. */
function checkDroppedSections(parsed: ParsedMdx): ValidationIssue[] {
  const h2s = extractH2Titles(parsed.body);
  const issues: ValidationIssue[] = [];

  for (const mustDrop of HARD_CONSTRAINTS.mustDropSections) {
    for (const h2 of h2s) {
      if (h2.includes(mustDrop) || h2.includes(mustDrop.replace(/[🎯🔍😱✨🔬💻📊⚖️📌🤔]/gu, '').trim())) {
        issues.push({
          severity: 'error',
          rule: 'must-drop-section',
          message: `Section "${mustDrop}" must be dropped from blog post, but found H2 "${h2}".`,
        });
      }
    }
  }
  return issues;
}

/** Hard constraint 6: draft: true must be set. */
function checkDraftFlag(parsed: ParsedMdx): ValidationIssue[] {
  if (parsed.frontmatter.draft !== true) {
    return [
      {
        severity: 'error',
        rule: 'draft-flag',
        message: 'Frontmatter must have `draft: true`. The agent always produces drafts; humans set featured/publish.',
      },
    ];
  }
  return [];
}

/** Hard constraint 6: featured: false must be set. */
function checkFeaturedFlag(parsed: ParsedMdx): ValidationIssue[] {
  if (parsed.frontmatter.featured !== false) {
    return [
      {
        severity: 'error',
        rule: 'featured-flag',
        message: 'Frontmatter must have `featured: false`. Featured is human-curated.',
      },
    ];
  }
  return [];
}

/** Hard constraint 8: MDX imports only for components actually used. */
function checkMdxImports(parsed: ParsedMdx): ValidationIssue[] {
  const imports = extractMdxImports(parsed.body);
  const issues: ValidationIssue[] = [];

  for (const { component, line } of imports) {
    // Search for actual usage: `<Component` followed by space/> or newline.
    // Regex anchors on the opening angle bracket to avoid false positives from plain text.
    const usageRegex = new RegExp(`<${component}[\\s/>]`, 'u');
    if (!usageRegex.test(parsed.body)) {
      issues.push({
        severity: 'warning',
        rule: 'unused-mdx-import',
        message: `Imported "${component}" at "${line.trim()}" but never used it. Remove the import.`,
      });
    }
  }
  return issues;
}

/** Hard constraint 11: code blocks need language tags (except ASCII diagrams). */
function checkCodeBlockLangTags(parsed: ParsedMdx): ValidationIssue[] {
  const codeBlocks = extractCodeBlocks(parsed.body);
  const issues: ValidationIssue[] = [];

  for (const block of codeBlocks) {
    // No language tag is OK only if block looks like ASCII art.
    // Heuristic: contains box-drawing chars or only whitespace+punctuation.
    if (!block.lang) {
      const isAscii = /[┌┐└┘│─┤├┬┴┼╭╮╰╯╱╲]/u.test(block.content);
      if (!isAscii) {
        issues.push({
          severity: 'warning',
          rule: 'missing-lang-tag',
          message: `Code block starting "${block.firstLine.slice(0, 50)}..." has no language tag. Add \`\`\`bash / \`\`\`java etc.`,
        });
      }
    }
  }

  return issues;
}

/** Hard constraint 10: `$$` math blocks must be surrounded by blank lines. */
function checkMathBlockSpacing(parsed: ParsedMdx): ValidationIssue[] {
  const lines = parsed.body.split('\n');
  const issues: ValidationIssue[] = [];

  for (let i = 0; i < lines.length; i++) {
    if (lines[i]?.trim() === '$$') {
      // Previous line must be blank (or start of body).
      const prev = i > 0 ? lines[i - 1]?.trim() : '';
      if (prev !== undefined && prev !== '' && i > 0) {
        issues.push({
          severity: 'warning',
          rule: 'math-block-spacing',
          message: `Line ${i + 1}: "$$" must have a blank line before it.`,
        });
      }
    }
  }
  return issues;
}

/* ─────────────────────────────────────────────────────────────
   Metric computation
   ───────────────────────────────────────────────────────────── */

function computeMetrics(parsed: ParsedMdx): ValidationResult['metrics'] {
  const stripped = stripMdx(parsed.body);
  return {
    wordCount: countWords(stripped),
    h2Count: extractH2Titles(parsed.body).length,
    codeBlockCount: extractCodeBlocks(parsed.body).length,
    mathBlockCount: (parsed.body.match(/\n\$\$/g) || []).length / 2, // opening = closing pairs
    mdxComponentCount: countMdxComponentUsage(parsed.body),
  };
}

/* ─────────────────────────────────────────────────────────────
   Text processing — extract/strip helpers.
   These are deliberately boring: simple string/regex ops, no AST.
   MDX is a union of Markdown + JSX-like tags; full parsing isn't
   worth the dependency weight for these checks.
   ───────────────────────────────────────────────────────────── */

/** Strip MDX-specific syntax (imports, JSX components, code blocks) for word counting. */
function stripMdx(body: string): string {
  let out = body;

  // Remove import lines.
  out = out.replace(/^import\s.+$/gm, '');

  // Remove fenced code blocks entirely.
  out = out.replace(/```[\s\S]*?```/g, '');

  // Remove JSX component tags (keep inner text for counting).
  // e.g. <Callout type="note">...</Callout> → "..."
  out = out.replace(/<\/?[A-Z][A-Za-z0-9]*(\s[^>]*)?\/?>/g, '');

  // Remove inline/block math markers ($ and $$) but keep the math content
  // so words within it count approximately.
  out = out.replace(/\$\$/g, '');
  out = out.replace(/\$/g, '');

  return out;
}

function stripMdxImports(body: string): string {
  return body.replace(/^import\s.+$/gm, '');
}

/**
 * Count words: Korean characters grouped by whitespace + English words.
 * Matches the methodology used to measure existing posts (wc -w compatible).
 */
function countWords(text: string): number {
  return text
  .trim()
  .split(/\s+/)
  .filter((tok) => tok.length > 0)
      .length;
}

/**
 * Count sentences in Korean + English text.
 * Splits on `.`, `?`, `!` (Korean uses same punctuation).
 */
function countSentences(text: string): number {
  return text
  .split(/[.?!]\s*/)
  .filter((s) => s.trim().length > 0)
      .length;
}

/** Extract all H2 titles (content after `## `, excluding leading/trailing space). */
function extractH2Titles(body: string): string[] {
  const titles: string[] = [];
  for (const line of body.split('\n')) {
    const match = /^##\s+(.+)$/.exec(line);
    if (match && !line.startsWith('###')) {
      const title = match[1];
      if (title !== undefined) {
        titles.push(title.trim());
      }
    }
  }
  return titles;
}

/** Extract intro — text between imports section and first H2. */
function extractIntro(body: string): string {
  // Remove ALL import lines (not just contiguous leading ones).
  // This prevents `.astro`, `.ts` extensions in import paths from being
  // counted as sentence terminators.
  const withoutImports = body.replace(/^import\s.+$/gm, '');

  const firstH2Index = withoutImports.indexOf('\n## ');
  if (firstH2Index === -1) return withoutImports.trim();
  return withoutImports.slice(0, firstH2Index).trim();
}

interface CodeBlock {
  lang: string | null;
  content: string;
  firstLine: string;
}

/** Extract fenced code blocks with their language tags. */
function extractCodeBlocks(body: string): CodeBlock[] {
  const blocks: CodeBlock[] = [];
  const regex = /```(\w*)\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(body)) !== null) {
    const rawLang = match[1] ?? '';
    const content = match[2] ?? '';
    blocks.push({
      lang: rawLang === '' ? null : rawLang,
      content,
      firstLine: content.split('\n')[0] ?? '',
    });
  }
  return blocks;
}

interface MdxImport {
  component: string;
  line: string;
}

/** Extract `import X from '...'` lines — returns component names. */
function extractMdxImports(body: string): MdxImport[] {
  const imports: MdxImport[] = [];
  const regex = /^import\s+(\w+)\s+from\s+['"][^'"]+['"];?\s*$/gm;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(body)) !== null) {
    const component = match[1];
    if (component !== undefined) {
      imports.push({ component, line: match[0] });
    }
  }
  return imports;
}

/** Rough count of MDX component usage (e.g. `<Callout>`, `<Theorem>`). */
function countMdxComponentUsage(body: string): number {
  const matches = body.match(/<[A-Z][A-Za-z0-9]*(\s[^>]*)?\/?>/g);
  return matches ? matches.length : 0;
}

/* ─────────────────────────────────────────────────────────────
   Formatting helpers — for use by the retry-loop orchestrator.
   ───────────────────────────────────────────────────────────── */

/**
 * Format validation issues as a concise feedback block to include in the
 * retry prompt. The agent receives this and is expected to fix each issue.
 */
export function formatIssuesForRetry(issues: ValidationIssue[]): string {
  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');

  const lines: string[] = [];
  lines.push('The previous output FAILED validation. Fix these issues and regenerate:');
  lines.push('');

  if (errors.length > 0) {
    lines.push('ERRORS (must fix):');
    for (const issue of errors) {
      lines.push(`  - [${issue.rule}] ${issue.message}`);
    }
  }

  if (warnings.length > 0) {
    lines.push('');
    lines.push('WARNINGS (fix if possible):');
    for (const issue of warnings) {
      lines.push(`  - [${issue.rule}] ${issue.message}`);
    }
  }

  lines.push('');
  lines.push('Return the corrected MDX file. No explanation, no code fence wrapping.');
  return lines.join('\n');
}
