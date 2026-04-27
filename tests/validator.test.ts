/**
 * iq-blogger — Validator unit tests
 *
 * Each test targets one hard constraint. Fixtures use minimal MDX
 * that satisfies all other constraints except the one being tested.
 */

import { describe, expect, it } from 'vitest';
import { validate } from '../src/validator.js';

/** One unit of filler adds ~12 words. Used to pad body to ~300 words. */
const FILLER = '\n추가 설명이 필요하다. 이 구조는 반복적으로 검증되었다. 독자는 이를 통해 핵심을 파악한다.';

/** Reusable valid frontmatter + skeleton body. Modify per test. */
function buildValidMdx(overrides: {
  frontmatter?: string;
  body?: string;
  fillerRepeats?: number;
} = {}): string {
  const frontmatter =
      overrides.frontmatter ??
      `---
title: "테스트 포스트 제목"
description: "테스트용 설명 문장이다. 충분히 길어야 한다."
pubDate: 2026-04-21
category: dev
tags: [test, sample, example]
difficulty: intermediate
series:
  slug: test-series
  title: Test Series
  order: 1
draft: true
featured: false
---`;

  const body =
      overrides.body ??
      `
이것은 인트로다. 블로그 포스트는 H2 없이 시작한다. 왜 이런 구조가 좋은가?

## 첫 번째 섹션

여기에 본문이 들어간다. 각 섹션은 의미 있는 내용을 담는다. 코드 예시도 가능하다.

## 두 번째 섹션

더 많은 내용. 실제 포스트는 300 단어 내외를 유지한다. 이 테스트에서는 적당한 분량으로.

## 세 번째 섹션

세 번째다. 트레이드오프 같은 개념을 다룬다. 현실 세계의 문제다.

## 네 번째 섹션

네 번째 섹션이다. 패턴과 원리를 설명한다. 코드로 구체화할 수 있다.

## 정리

- 첫 번째 정리
- 두 번째 정리
- 세 번째 정리
`;

  // Body without filler ≈ 85 words. FILLER adds ~12 words per repeat.
  // Default 80 repeats → ~1045 words (in recommended 700-1500 range, no warnings)
  const repeats = overrides.fillerRepeats ?? 80;
  const filler = FILLER.repeat(repeats);
  return frontmatter + body + filler;
}

describe('validator', () => {
  describe('word count', () => {
    it('passes when in recommended range (700-1500)', () => {
      const mdx = buildValidMdx();
      const result = validate(mdx);
      const wc = result.metrics.wordCount;
      expect(wc).toBeGreaterThanOrEqual(700);
      expect(wc).toBeLessThanOrEqual(1500);
      expect(result.ok).toBe(true);
      // No word-count warnings expected in recommended range
      expect(result.issues.filter((i) => i.rule.startsWith('word-count')).length).toBe(0);
    });

    it('fails when too short', () => {
      // No filler — body alone is ~85 words, well below 270.
      const mdx = buildValidMdx({ fillerRepeats: 0 });
      const result = validate(mdx);
      expect(result.ok).toBe(false);
      expect(result.issues.some((i) => i.rule === 'word-count')).toBe(true);
    });

    it('warns but passes when below warningMin (700)', () => {
      // 50 repeats → ~685 words: above hard min 500, below warningMin 700
      const mdx = buildValidMdx({ fillerRepeats: 50 });
      const result = validate(mdx);
      expect(result.ok).toBe(true);
      expect(result.issues.some((i) => i.rule === 'word-count-short')).toBe(true);
    });

    it('warns but passes when above warningMax (1500)', () => {
      // 130 repeats → ~1645 words: below hard max 2000, above warningMax 1500
      const mdx = buildValidMdx({ fillerRepeats: 130 });
      const result = validate(mdx);
      expect(result.ok).toBe(true);
      expect(result.issues.some((i) => i.rule === 'word-count-long')).toBe(true);
    });
  });

  describe('H2 structure', () => {
    it('fails when fewer than 5 H2s', () => {
      const mdx = buildValidMdx({
        body: `
인트로 문장 하나. 또 다른 문장. 질문?

## 섹션 하나

본문이다.

## 정리

- 정리 하나
`,
        fillerRepeats: 18,
      });
      const result = validate(mdx);
      expect(result.ok).toBe(false);
      expect(result.issues.some((i) => i.rule === 'h2-count')).toBe(true);
    });

    it('fails when last H2 is not "정리"', () => {
      const mdx = buildValidMdx({
        body: `
인트로 문장 하나. 또 다른 문장. 질문?

## A
본문 하나.

## B
본문 둘.

## C
본문 셋.

## D
본문 넷.

## 결론
결론 내용.
`,
        fillerRepeats: 18,
      });
      const result = validate(mdx);
      expect(result.issues.some((i) => i.rule === 'last-h2-title')).toBe(true);
    });
  });

  describe('polite tone', () => {
    it('fails when 합니다 appears', () => {
      const mdx = buildValidMdx({
        body: `
이것은 인트로다. 왜 이런가?

## 섹션

이 글에서는 설명합니다. 본문 내용이 여기 있다.

## 섹션 둘
내용이다.

## 섹션 셋
내용이다.

## 섹션 넷
내용이다.

## 정리
- 정리
`,
        fillerRepeats: 18,
      });
      const result = validate(mdx);
      expect(result.ok).toBe(false);
      expect(result.issues.some((i) => i.rule === 'polite-tone')).toBe(true);
    });
  });

  describe('title emoji', () => {
    it('fails when H2 contains template emoji', () => {
      const mdx = buildValidMdx({
        body: `
인트로 문장이다. 왜 그런가?

## 🎯 핵심 질문

여기서 설명한다. 본문이다.

## 섹션 둘
내용이다.

## 섹션 셋
내용이다.

## 섹션 넷
내용이다.

## 정리
- 정리
`,
        fillerRepeats: 18,
      });
      const result = validate(mdx);
      expect(result.ok).toBe(false);
      expect(result.issues.some((i) => i.rule === 'title-emoji')).toBe(true);
    });
  });

  describe('draft flag', () => {
    it('fails when draft: false', () => {
      const mdx = buildValidMdx({
        frontmatter: `---
title: "테스트 포스트"
description: "테스트 설명 문장."
pubDate: 2026-04-21
category: dev
tags: [test, sample, example]
draft: false
featured: false
---`,
      });
      const result = validate(mdx);
      expect(result.ok).toBe(false);
      expect(result.issues.some((i) => i.rule === 'draft-flag')).toBe(true);
    });
  });

  describe('tag format', () => {
    it('fails when tag count is < 3', () => {
      const mdx = buildValidMdx({
        frontmatter: `---
title: "테스트 포스트 제목"
description: "테스트용 설명 문장이다."
pubDate: 2026-04-21
category: dev
tags: [one, two]
draft: true
featured: false
---`,
      });
      const result = validate(mdx);
      expect(result.ok).toBe(false);
      expect(result.issues.some((i) => i.rule === 'tag-count')).toBe(true);
    });

    it('fails when tag is not kebab-case', () => {
      const mdx = buildValidMdx({
        frontmatter: `---
title: "테스트 포스트 제목"
description: "테스트용 설명 문장이다."
pubDate: 2026-04-21
category: dev
tags: [Test, sample, example]
draft: true
featured: false
---`,
      });
      const result = validate(mdx);
      expect(result.ok).toBe(false);
      expect(result.issues.some((i) => i.rule === 'tag-format')).toBe(true);
    });
  });

  describe('frontmatter schema', () => {
    it('fails when required field is missing', () => {
      const mdx = `---
title: "테스트"
pubDate: 2026-04-21
category: dev
tags: [a, b, c]
draft: true
featured: false
---

인트로다. 질문?

## A
## B
## C
## D
## 정리
`;
      // Missing description field.
      const result = validate(mdx);
      expect(result.ok).toBe(false);
      expect(result.issues.some((i) => i.rule === 'frontmatter-schema')).toBe(true);
    });
  });

  describe('unused MDX import (warning)', () => {
    it('warns when import is not used', () => {
      const mdx = buildValidMdx({
        body: `
import Callout from '@/components/mdx/Callout.astro';
import Theorem from '@/components/mdx/Theorem.astro';

인트로 문장이다. 왜 그런가?

## 섹션

<Callout type="note">사용된다</Callout>

내용이다.

## 섹션 둘
내용이다.

## 섹션 셋
내용이다.

## 섹션 넷
내용이다.

## 정리
- 정리
`,
        fillerRepeats: 18,
      });
      const result = validate(mdx);
      // Theorem imported but never used → warning.
      expect(
          result.issues.some((i) => i.rule === 'unused-mdx-import' && i.message.includes('Theorem')),
      ).toBe(true);
    });
  });

  describe('happy path', () => {
    it('passes a fully compliant post', () => {
      const mdx = buildValidMdx();
      const result = validate(mdx);
      if (!result.ok) {
        console.error('Unexpected validation failures:', result.issues);
      }
      expect(result.ok).toBe(true);
    });
  });
});
