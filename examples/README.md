# Original Blog Examples (Archived)

These are the two original hand-written posts that defined `iq-proof.github.io`'s tone and structure:

- `attention-sqrt-d-scaling.mdx` — AI category, math + theorem/proof example
- `spring-aop-proxy-mechanics.mdx` — Dev category, system design example

## Role in iq-blogger

These posts are encoded as few-shot examples in `prompts/few-shot.md`. They define:

- Tone: 평서체 (~한다), direct, "왜?" pursuit
- Structure: 5-7 H2 sections, last is `## 정리`
- Length: synthesized posts target 700-1500 words
- Components: Callout, Theorem, Proof, Aside, Reference (when relevant)

## Why archived?

After validating the synthesis system across Redis (dev) and Transformer (ai) repos, these examples were retired from the live blog. The blog now contains synthesis-generated posts that follow the same patterns these examples established.

Kept here for:
- Historical reference (the genesis of iq-blogger)
- Recovery if the few-shot examples need to be re-derived
- Tone calibration when prompts need tuning
