<h1 align="center">
  <img src="https://api.iconify.design/lucide/bot.svg?color=%23cc785c" width="32" align="center"/>
  iq-blogger
</h1>

<div align="center">

**deep-dive 레포를 블로그 시리즈로 자동 변환하는 에이전트**

<br/>

[![iq-agent-lab](https://img.shields.io/badge/Part_of-iq--agent--lab-cc785c?style=for-the-badge&logo=anthropic&logoColor=white)](https://iq-agent-lab.github.io)
[![Output Site](https://img.shields.io/badge/Output-iq--proof.github.io-00d9ff?style=for-the-badge&logo=astro&logoColor=white)](https://iq-proof.github.io)

<br/>

> *"5-7 챕터(~3500줄) → 종합 에세이 1편(~1000단어). 챕터들의 공통 원리를 추출한다."*

86개 deep-dive 레포의 600여 폴더를 블로그 종합 에세이로 양산한다. 단순 요약이 아닌, **합성(synthesis)** — 여러 챕터를 관통하는 하나의 원리를 발견한다.

</div>

---

## 🎯 What This Does

`iq-blogger`는 [iq-agent-lab](https://iq-agent-lab.github.io)의 첫 번째 자동화 도구다. [iq-dev-lab](https://github.com/iq-dev-lab)과 [iq-ai-lab](https://github.com/iq-ai-lab)의 deep-dive 폴더(5-7개 챕터, ~3500줄)를 [iq-proof](https://iq-proof.github.io) 블로그의 종합 에세이(~1000단어, 5-7개 H2)로 변환한다.

### 변환 예시

```
입력:  iq-ai-lab/transformer-deep-dive/ch1-attention-decomposition/
       ├── 01-scaled-dot-product.md
       ├── 02-sqrt-dk-scaling.md
       ├── 03-softmax-saturation.md
       ├── 04-attention-as-kernel.md
       ├── 05-multi-head.md
       └── 06-interpretability-debate.md
       (6개 챕터, 학술 자료체)

출력:  drafts/iq-ai-lab-transformer-deep-dive/ch1-attention-decomposition.mdx
       "Attention은 왜 그렇게 설계됐는가"
       (6 H2, 803 단어, 평서체, Theorem/Proof 컴포넌트, 통합 메시지)
```

### 합성의 본질 — 단순 요약이 아니다

| 축 | 입력 (deep-dive 시리즈) | 출력 (종합 에세이) |
|:---|:---|:---|
| **목적** | 가르치기 | 통합 원리 발견 |
| **단위** | 5-7개 분리된 챕터 | 1개의 통합 글 |
| **톤** | "~합니다" (경어체) | "~한다" (평서체) |
| **구조** | 각 챕터 독립 10섹션 | 하나의 narrative arc |
| **메시지** | 챕터별 "무엇" | 전체를 관통하는 "왜" |
| **길이** | ~3500줄 | ~1000단어 |

핵심: **공통 원리 발견**. 예: Redis의 단일 스레드, 메모리, 만료, Threaded I/O가 별개로 보이지만 사실 모두 *"명령어 실행의 단순성을 유지하면서 나머지 병목만 제거하라"*는 한 원칙에서 나옴.

---

## ✅ Status — Validated

| 도메인 | 레포 | 폴더 | 챕터 | 결과 |
|:---|:---|:---:|:---:|:---:|
| Dev | redis-deep-dive | redis-internals | 5 | ✅ 624w, 1 attempt, $0.23 |
| AI | transformer-deep-dive | ch1-attention-decomposition | 6 | ✅ 803w, 1 attempt, $0.22 |
| AI | transformer-deep-dive | ch2-transformer-architecture | 5 | ✅ 751w, 1 attempt, $0.21 |
| AI | transformer-deep-dive | ch3-positional-encoding | 5 | ✅ 732w, 1 attempt, $0.21 |
| AI | transformer-deep-dive | ch4-training-math | 5 | ✅ 830w, 1 attempt, $0.20 |
| AI | transformer-deep-dive | ch5-attention-efficiency | 6 | ✅ 883w, 1 attempt, $0.25 |
| AI | transformer-deep-dive | ch6-modern-architectures | 5 | ✅ 796w, 1 attempt, $0.21 |
| AI | transformer-deep-dive | ch7-llm-icl | 4 | ✅ 959w, 1 attempt, $0.19 |

**8/8 폴더 첫 시도 통과 (재시도 0%). 평균 $0.215/폴더, 1분 9초/폴더.**

---

## 🏗️ How It Works

```mermaid
graph LR
    A[GitHub source repo] --> B[git-ops: clone or pull]
    B --> C[repo-converter: discover folders]
    C --> D[folder-converter: synthesize]
    D --> E[agent: Claude API call]
    E --> F[validator: 12 constraints]
    F -->|Pass| G[Write .mdx to drafts/]
    F -->|Fail, retry up to 3| E
    G --> H[publisher: deploy]
    H --> I[Live on iq-proof.github.io]

    style A fill:#fce4ec,stroke:#cc785c,stroke-width:2px
    style E fill:#fff3e0,stroke:#cc785c,stroke-width:2px
    style F fill:#e8f5e9,stroke:#cc785c,stroke-width:2px
    style G fill:#e3f2fd,stroke:#cc785c,stroke-width:2px
    style I fill:#f3e5f5,stroke:#cc785c,stroke-width:2px
```

### 핵심 컴포넌트

| 파일 | 역할 |
|:---|:---|
| `src/agent.ts` | Claude API 호출 + 재시도 루프 |
| `src/validator.ts` | 12개 검증 규칙 (error + warning 2-tier) |
| `src/folder-converter.ts` | 폴더 5-7 챕터를 1개 종합 글로 |
| `src/repo-converter.ts` | 레포 단위 — 모든 폴더 자동 발견 + 처리 |
| `src/git-ops.ts` | GitHub 자동 클론 + 캐싱 (`.cache/sources/`) |
| `src/progress.ts` | 진행 상태 추적 (`drafts/progress.json`) |
| `src/publisher.ts` | 배포 — drafts → blog → commit → push |
| `src/types.ts` | Zod 스키마 + 공유 타입 |
| `src/index.ts` | CLI: 8개 명령어 |
| `prompts/system.md` | 합성 system prompt |
| `prompts/few-shot.md` | 변환 예시 (Spring AOP, Attention, Redis) |

---

## ⚙️ The 12 Constraints

### Hard errors (재시도 트리거)

| # | 제약 |
|:--:|:---|
| 1 | 단어 수 500-2000 (권장 700-1500, 1000 목표) |
| 2 | H2 5-7개, 마지막 "정리" |
| 3 | 인트로 H2 없이 시작, 5문장 이내 |
| 4 | tags 3-5개 + kebab-case |
| 5 | 경어체 금지 (`~합니다` → `~한다`) |
| 6 | 제목 이모지 금지 |
| 7 | "💻 실전 실험", "🤔 생각해볼" 섹션 제거 |
| 8 | `draft: true`, `featured: false` |
| 12 | Reference 환각 방지 — 본문 인용된 논문만 사용 |

### Warnings (통과는 가능, 정보용)

| # | 제약 |
|:--:|:---|
| 9 | 미사용 MDX import |
| 10 | 코드블록 언어 태그 누락 |
| 11 | `$$` 블록 위아래 빈 줄 |

검증 실패 시 자동 재시도 (최대 3회). 실제 양산에서는 100% 첫 시도 통과.

---

## 🚀 Setup

### Prerequisites
- Node.js 20+
- npm
- Anthropic API key (with credits)
- iq-proof 블로그 레포 (로컬에 클론됨)

### Install

```bash
git clone https://github.com/iq-agent-lab/iq-blogger.git
cd iq-blogger
npm install
```

### Configure

```bash
cp .env.example .env
# .env 편집
```

`.env` 필수 항목:

```bash
ANTHROPIC_API_KEY=sk-ant-api03-...
IQ_BLOGGER_MODEL=claude-sonnet-4-6
IQ_BLOGGER_MAX_RETRIES=3
IQ_BLOGGER_DEBUG=0
IQ_PROOF_PATH=/Users/<you>/iq-lab/iq-proof.github.io

# Public 레포는 토큰 불필요. private 레포 시 사용.
GITHUB_TOKEN=ghp_...
```

### Verify

```bash
npm test       # 14개 테스트 통과
npm run lint   # tsc --noEmit, 타입 에러 없음
```

---

## 💻 Usage

### 양산 워크플로우 (3단계)

```bash
# 1. 양산 — 레포 자동 클론 + 모든 폴더 종합
npx tsx src/index.ts convert-repo iq-ai-lab/<레포명>

# 2. 진행 확인
npx tsx src/index.ts status

# 3. 배포 — drafts → blog → commit → push (자동)
npx tsx src/index.ts deploy --repo iq-ai-lab/<레포명>
```

### 모든 명령어

| 명령어 | 용도 |
|:---|:---|
| `convert-repo <org/repo>` | 레포 자동 클론 + 모든 폴더 종합 (양산) |
| `convert-folder <path>` | 단일 폴더 종합 (수동) |
| `convert <file>` | 단일 챕터 변환 (1챕터 → 1글, 레거시) |
| `status` | 진행 상태 확인 |
| `clone <org/repo>` | 소스 레포만 클론 (디버깅) |
| `validate <file>` | 기존 .mdx 검증 |
| `deploy [--repo X]` | 블로그로 배포 (자동 commit + push) |
| `revert [--repo X \| --slug Y]` | 배포 후 retract |

### 출력 예시 — `convert-repo`

```
[git-ops] Updating iq-ai-lab/transformer-deep-dive (cache hit)...
[repo-converter] Found 7 folder(s) to process

[1/7] ch1-attention-decomposition ... ⏭️  skipped (already done)
[2/7] ch2-transformer-architecture ... ⏭️  skipped (already done)
[3/7] ch3-positional-encoding ... ✅ done (732w, 1 attempt, $0.21)
[4/7] ch4-training-math ... ✅ done (830w, 1 attempt, $0.20)
[5/7] ch5-attention-efficiency ... ✅ done (883w, 1 attempt, $0.25)
[6/7] ch6-modern-architectures ... ✅ done (796w, 1 attempt, $0.21)
[7/7] ch7-llm-icl ... ✅ done (959w, 1 attempt, $0.19)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Summary for iq-ai-lab/transformer-deep-dive:
  ✅ Done:     5
  ⏭️  Skipped:  2
  ❌ Failed:   0
  Total cost: $1.06
  Duration:   344.6s
```

### Recovery

문제 발견 시:
```bash
# 단일 글 retract
npx tsx src/index.ts revert --slug ch7-llm-icl

# 전체 레포 retract
npx tsx src/index.ts revert --repo iq-ai-lab/transformer-deep-dive
```

---

## 💰 Cost

Claude Sonnet 4.5 기준 (실측):

| 단위 | 비용 | 시간 |
|:---|:---|:---|
| 폴더 1개 (5-7챕터) | ~$0.22 | ~69초 |
| 레포 1개 (~7폴더) | ~$1.50 | ~8분 |
| 전체 86 레포 (~600폴더) | ~$130-140 | ~12시간 |

8 폴더 양산 후 누적: **$1.72**.

---

## 🛣️ Roadmap

| Phase | Status | Description |
|:----:|:------:|:------------|
| 1 | ✅ | `agent.ts` — Claude API + 재시도 루프 |
| 2 | ✅ | `validator.ts` — 12개 검증 규칙 (2-tier) |
| 3 | ✅ | `folder-converter.ts` — 종합 변환 |
| 4 | ✅ | `git-ops.ts` — GitHub 자동 클론 |
| 5 | ✅ | `repo-converter.ts` — 레포 단위 자동화 |
| 6 | ✅ | `progress.ts` — 진행 추적 |
| 7 | ✅ | `publisher.ts` — 배포 자동화 (deploy/revert) |
| 8 | 🚧 | 본격 양산 (Dev 38 + AI 48 = 86 레포) |

---

## 🧠 Design Decisions

### Why folder = 1 post (not chapter = 1 post)?
- 1 챕터 = 1 글이면 3000+ 글이 양산됨 — GitHub Pages 한계 + "그냥 옮긴 느낌"
- 5-7 챕터 종합 = 600 글 — 적정 양 + **큐레이션의 의미**
- 합성은 챕터들의 공통 원리를 발견하는 작업, 가치 있음

### Why Anthropic SDK (not Claude Agent SDK)?
- 입출력이 순수 텍스트 (.md → .mdx). Tool use 불필요
- 재시도를 validator 결과 기반으로 결정적 제어
- 토큰·비용 정확한 예측

### Why 2-tier validation (error + warning)?
- 빡빡한 검증은 재시도 진동(oscillation) 유발
- Hard error (재시도) vs Warning (정보용 통과) 분리
- 첫 시도 통과율 100% 달성

### Why no auto-publish to blog without review?
- "Curation is non-negotiable" — 메타 글의 핵심 원칙
- 자동: 양산, 검증, 배포 명령
- 수동: 검수 + 발행 결정 (`deploy` 실행 시점)
- `revert` 명령으로 사후 수정 가능

설계 회고: [iq-proof: 이 블로그는 어떻게 만들어졌나](https://iq-proof.github.io/posts/iq-blogger-system).

---

## 🔗 Related

- **[iq-agent-lab](https://iq-agent-lab.github.io)** — 이 도구가 속한 자동화 인프라 연구소
- **[iq-proof](https://iq-proof.github.io)** — 변환 결과가 발행되는 블로그
- **[iq-dev-lab](https://github.com/iq-dev-lab)** — 입력 소스 #1 (백엔드 deep-dive)
- **[iq-ai-lab](https://github.com/iq-ai-lab)** — 입력 소스 #2 (AI deep-dive)

---

<div align="center">

*iq-blogger는 iq-agent-lab의 첫 번째 검증 사례입니다.<br/>
"검증 가능한 자동화"가 텍스트 생성 도메인에서 작동함을 증명합니다.*

<br/>

Operated by [@e9ua1](https://github.com/e9ua1) (아이큐).

</div>
