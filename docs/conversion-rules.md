# iq-blogger — Conversion Rules

변환 규칙의 단일 출처(single source of truth). 이 문서가 에이전트의 동작을 결정한다. 모호한 규칙은 여기서 전부 결정적으로 고정한다.

---

## 1. 블로그 사이트 스펙

### 1.1 기술 스택

| 구성 요소 | 값 |
|:---|:---|
| SSG | Astro 5 + `@astrojs/mdx` |
| 콘텐츠 로더 | `astro:content` with `glob` loader |
| 스타일 | Tailwind CSS 4 (`@tailwindcss/vite`) |
| 수식 | remark-math + rehype-katex (**KaTeX**) |
| 코드 하이라이팅 | Shiki, theme = `night-owl`, `wrap: true` |
| 검색 | Pagefind (빌드 시 인덱싱) |
| 댓글 | Giscus (GitHub Discussions, `pathname` 매핑) |
| 분석 | GoatCounter (`code: iq-proof`) |
| OG 이미지 | Satori, 포스트별 자동 생성 |
| 배포 | GitHub Pages, `https://iq-proof.github.io` |
| CI | GitHub Actions — push 트리거, `.github/workflows/deploy.yml` |

### 1.2 포스트 파일 저장 경로

```
src/content/posts/<slug>.mdx
```

**규칙 (결정적)**:
- 확장자 = **`.mdx`** (항상). `.md`는 쓰지 않는다. MDX 컴포넌트 6종을 쓸 수 있어야 하므로.
- 날짜는 파일명에 포함하지 않는다 (`pubDate` frontmatter가 단일 진실).
- slug는 kebab-case 영문. 공백·대문자·한글·밑줄 금지.
- 파일명 = slug. URL은 `/posts/<slug>`.
- 경로에 하위 폴더 없음. 평평한 구조.

### 1.3 Frontmatter 필드 전체 목록

소스: `src/content.config.ts` (Zod 스키마, 실제 검증됨)

| 필드 | 타입 | 필수 | 기본값 | 예시 | 의미 |
|:---|:---|:---:|:---|:---|:---|
| `title` | string(1-120) | ✅ | — | `"Spring AOP는 왜 프록시 기반일까"` | 포스트 제목. 반드시 질문형 또는 명제형. |
| `description` | string(1-240) | ✅ | — | `"Self-invocation 문제의 근본 원인부터..."` | 메타 description, 카드 썸네일 요약. **한 문장으로 압축, 해결하려는 문제 + 도달점 명시**. |
| `pubDate` | ISO date | ✅ | — | `2026-04-17` | 발행일. YYYY-MM-DD. |
| `updatedDate` | ISO date | ❌ | — | `2026-05-01` | 수정일. 최초 발행 시 생략. |
| `category` | enum | ✅ | — | `dev` \| `ai` | 둘 중 하나. **iq-dev-lab 소스 → `dev`**, **iq-ai-lab 소스 → `ai`**. |
| `tags` | string[] | ✅ | `[]` | `[spring, aop, proxy, jvm]` | 3-5개. 소문자 kebab-case. 자유형식이나 §1.5 참고. |
| `series` | object | ❌ | — | (아래) | 시리즈 소속. 챕터 단위 포스팅은 거의 항상 시리즈에 소속됨. |
| `series.slug` | string | — | — | `"spring-aop-internals"` | 시리즈 URL slug. kebab-case. |
| `series.title` | string | — | — | `"Spring AOP Internals"` | 시리즈 표시명. |
| `series.order` | int>0 | — | — | `1` | 시리즈 내 순서. 1부터. |
| `difficulty` | enum | ❌ | — | `intermediate` | `beginner` \| `intermediate` \| `advanced` 중 하나. §1.5 판단 기준 참고. |
| `heroImage` | image | ❌ | — | — | 히어로 이미지. **없으면 Satori OG 자동 생성**되므로 생략 권장. |
| `heroAlt` | string | ❌ | — | — | heroImage 있을 때만. |
| `draft` | boolean | ❌ | `false` | `false` | 초안 여부. 에이전트가 생성한 포스트는 **항상 `draft: true`로 PR** (사람 리뷰 후 머지 단계에서 `false`로). |
| `featured` | boolean | ❌ | `false` | `true` | 홈 상단 노출. **에이전트는 항상 `false`** (featured는 사람이 선별). |

### 1.4 자산 처리

| 자산 | 처리 방식 |
|:---|:---|
| 수식(인라인) | `$...$` — KaTeX 렌더. 예: `쿼리 $q \in \mathbb{R}^{d_k}$` |
| 수식(블록) | `$$...$$` — 위아래 빈 줄 필수. |
| 코드 블록 | ` ```lang ` + `wrap: true`로 수평 스크롤 없음. 파일명 주석은 첫 줄 `// path/to/File.java` 또는 `# path/to/file.py` 형식. |
| 이미지 | **현재 포스트에는 이미지가 없다.** 이미지 필요시 `public/images/<slug>/<n>.webp`에 두고 MDX에서 절대경로 `/images/<slug>/<n>.webp` 참조. 에이전트는 **이미지를 새로 생성하지 않는다**. |
| 다이어그램 | 원본 레포의 ASCII 다이어그램은 **Mermaid로 변환하거나 코드블록(` ``` `)으로 감싸서 유지**. §4.7 참고. |

### 1.5 카테고리·태그·난이도 체계

**Category (엄격 enum)**:
- `dev` → iq-dev-lab 출처 전부
- `ai` → iq-ai-lab 출처 전부

**Tags (자유형식 but 권장 어휘)**:

기존 포스트에서 쓰인 태그:
- Dev: `spring`, `aop`, `proxy`, `jvm`
- AI: `transformer`, `attention`, `softmax`, `variance`

**태그 생성 규칙** (에이전트):
- 3-5개 (미만/초과 금지)
- 소문자 kebab-case (`spring-aop` OK, `SpringAOP` 금지)
- 주제 기술 이름(`spring`, `redis`, `transformer`) 1-2개 + 개념 이름(`aop`, `mvcc`, `attention`) 1-2개 + 메커니즘(`proxy`, `lock`, `softmax`) 1개

**Difficulty 판단 기준**:
- `beginner` — 용어 정의·개념 소개 수준. 현재 포스트엔 예시 없음.
- `intermediate` — 메커니즘 + 트레이드오프 설명. 대부분의 변환 포스트가 여기 해당 (`spring-aop-proxy-mechanics`).
- `advanced` — 수학적 증명·내부 구현 레벨. (`attention-sqrt-d-scaling`).

**기본값 (에이전트)**: `intermediate`. 소스 문서가 Lemma/Proof/수식 유도 중심이면 `advanced`로 승격.

---

## 2. 기존 포스트 예시 분석

실측 기반. 포스트 2개 (`spring-aop-proxy-mechanics.mdx`, `attention-sqrt-d-scaling.mdx`).

### 2.1 구조적 지표 (놀라울 정도로 일관됨)

| 지표 | spring-aop | attention-sqrt-d | 의미 |
|:---|:---:|:---:|:---|
| 단어 수 (한+영) | 312 | 308 | **목표 = 300±30 단어** |
| H2 섹션 수 | 5 | 5 | **목표 = 5개** (하드 룰) |
| 코드블록 수 | 8 | 0 | 주제에 따라 0 또는 4-10 |
| `$$` 수식 블록 | 0 | 16 | AI 포스트는 수식 중심 |
| MDX 컴포넌트 수 | 5 (Callout, Theorem, Proof, Collapse×3, Aside) | 4 (Theorem, Proof, Callout, Aside, Reference×2) | **평균 4-6개** |

### 2.2 두 포스트의 섹션 골격 (실측)

**spring-aop-proxy-mechanics.mdx**:
```
1. [인트로 — H2 없음, 2-3 문장 직격]
2. ## 프록시 기반 설계의 출발점        ← Why
3. ## 프록시의 두 가지 구현             ← What
4. ## Self-Invocation 문제              ← Problem 제기 + Theorem/Proof
5. ## 해결책과 그 비용                  ← Options + 트레이드오프
6. ## 정리                              ← 결론 + 다음 글 예고
```

**attention-sqrt-d-scaling.mdx**:
```
1. [인트로 — H2 없음, 수식 + 질문]
2. ## 문제: 내적의 분산 폭발            ← Problem 제기 + Lemma/Proof
3. ## 왜 이게 문제인가: Softmax 포화    ← Why it matters
4. ## 해결: 분산을 1로 정규화           ← Solution (수학적)
5. ## Linear Attention의 가정           ← 확장/일반화
6. ## 정리                              ← 결론 (bullet)
```

**공통 패턴 — 5단 구조**:
```
① 인트로 (H2 없음, 문제 직격)
② 맥락/출발점      [Setup]
③ 핵심 메커니즘    [Core]
④ 함의/확장        [Implication]
⑤ 정리             [Closure]
```

### 2.3 "이 블로그다움"을 결정하는 스타일 특징 5개

1. **질문형/명제형 제목**. 평서문 제목 금지.
   - ✅ "Spring AOP는 왜 프록시 기반일까"
   - ✅ "Attention의 √d 스케일링은 어디서 왔나"
   - ❌ "Spring AOP 프록시 설명"

2. **인트로에서 "왜?"를 즉시 던진다**. 개요·배경 설명 생략.
   - ✅ "왜 하필 √d로 나누는가? 단순히 '실험적으로 잘 되더라'가 아니라..."
   - ❌ "Transformer는 2017년에 발표된 모델로..."

3. **"트레이드오프"를 반드시 언급**. 정답 강요하지 않고 비용 명시.
   - `<Callout type="note" title="트레이드오프">` 또는 `## 해결책과 그 비용` 같은 섹션.

4. **수학/코드를 무서워하지 않음**. 그러나 항상 **"왜 이 수식/코드인가"**의 맥락 먼저.

5. **마무리는 "다음 글 예고" 또는 "핵심 한 줄"**. 장황한 요약 금지.
   - ✅ "수식 한 줄 뒤에는 '그래디언트를 살려야 한다'는 구체적인 엔지니어링 요구가 숨어 있다."
   - ✅ "다음 글에서는 CGLIB가 `final` 메서드를 어떻게 처리하는지..."

### 2.4 MDX 컴포넌트 사용 패턴

소스: `src/components/mdx/`

| 컴포넌트 | 언제 쓰는가 | 예시 |
|:---|:---|:---|
| `Callout` | 박스 강조. `type`: `note` \| `warning` \| `tip` | `<Callout type="warning" title="Saturation의 본질">...</Callout>` |
| `Theorem` | 수학적 주장. `kind`: `theorem` \| `lemma` \| `proposition`. `number`, `title` 필수. | `<Theorem kind="lemma" number="1" title="내적의 분산">...</Theorem>` |
| `Proof` | Theorem 직후. 증명. | `<Proof>...</Proof>` |
| `Reference` | 참고 문헌. `title, authors, year, venue, url`. 포스트 마지막에 배치. | `<Reference title="Attention Is All You Need" authors="Vaswani et al." year={2017} venue="NeurIPS" url="..." />` |
| `Aside` | 사이드 노트. `label` 필수. 본문 흐름 끊지 않는 보충. | `<Aside label="설계 의도">...</Aside>` |
| `Collapse` | 접을 수 있는 상세. `title` 필수. 대안 해결책 3개 나열 같은 경우. | `<Collapse title="해결책 1 — 자기 자신을 주입받기">...</Collapse>` |
| `Figure` | 이미지 + 캡션. 현재 포스트에서 미사용. |

---

## 3. 딥다이브 원본 문서 스펙

소스: Redis `redis-internals/01-single-thread-event-loop.md` (607줄).

### 3.1 10섹션 템플릿 (확정)

| # | 섹션 | 평균 분량 | 역할 |
|:---:|:---|:---:|:---|
| 1 | `## 🎯 핵심 질문` | 5-8 bullet | 문서가 답할 질문 나열 (학습 목표) |
| 2 | `## 🔍 왜 이 개념이 실무에서 중요한가` | 2-3 문단 | 실무 동기, 몰랐을 때 생기는 문제 |
| 3 | `## 😱 흔한 실수 (Before — 원리를 모를 때의 접근)` | 코드블록 1-2개 | 잘못된 판단·안티패턴 시나리오 |
| 4 | `## ✨ 올바른 접근 (After — 원리를 알고 난 설계/운영)` | 코드블록 1-2개 | 원리 기반 해결 + 운영 도구 |
| 5 | `## 🔬 내부 동작 원리` | **가장 긺, 30-50%** | ASCII 다이어그램 + 서브섹션 3-6개. 본질. |
| 6 | `## 💻 실전 실험` | 실행 가능한 코드 | 직접 실행해 검증하는 스크립트 |
| 7 | `## 📊 성능 비교` | 벤치마크 표/그래프 | 정량적 수치 |
| 8 | `## ⚖️ 트레이드오프` | 표 | 각 선택의 비용/이득 |
| 9 | `## 📌 핵심 정리` | bullet 5-10개 | 요약 |
| 10 | `## 🤔 생각해볼 문제` | 질문 5-8개 | 응용/심화 질문 |

### 3.2 딥다이브 vs 블로그 포스트 — 본질 차이

| 축 | 딥다이브 (원본) | 블로그 포스트 (변환 결과) |
|:---|:---|:---|
| **대상 독자** | 체계적으로 학습하려는 사람. 레포 전체를 순서대로. | 검색/링크로 진입. 한 글로 완결된 통찰. |
| **목적** | 가르치기 (learning material) | 설득/납득 (essay) |
| **톤** | 교재체. "~합니다". 완전성 지향. | 짧은 직격체. "~한다". 핵심만. |
| **깊이** | 깊게 + 넓게 (모든 각도 커버) | 깊게 + 좁게 (한 가지 "왜?") |
| **길이** | 500-700줄 | **300±30 단어, H2 5개** |
| **독립성** | 시리즈 내 순차. 선행 지식 가정. | 단독 완결. 진입 장벽 낮춤. |
| **SEO** | 레포 내 위치 중요 | 제목 + description이 전부 |

---

## 4. 변환 규칙 (핵심)

### 4.1 섹션 매핑 표

**입력**: 딥다이브 1개 문서 (10섹션)  
**출력**: 블로그 포스트 1개 (H2 5개 + 인트로 + 정리)

| 딥다이브 섹션 | 블로그 위치 | 처리 방식 | 비고 |
|:---|:---|:---|:---|
| `🎯 핵심 질문` | **인트로 (H2 없음)** | **축약** | 질문 5-8개 중 **가장 날카로운 1개**만 뽑아 인트로의 마지막 문장으로. "왜 X인가?" 형태. |
| `🔍 왜 이 개념이 실무에서 중요한가` | **인트로 앞부분** | **축약** | 2-3문장으로. 길게 쓰지 않는다. |
| `😱 흔한 실수 (Before)` | **H2 #1 "문제" 섹션의 도입** | **축약** | 시나리오를 1-2문장으로 요약. 코드블록 1개만 유지. 또는 완전 생략 가능. |
| `✨ 올바른 접근 (After)` | **H2 #3-#4 "해결" 섹션** | **병합** | "흔한 실수"와 묶어 `## 문제와 해결` 또는 분리해서 Before/After를 한 섹션 안에. |
| `🔬 내부 동작 원리` | **H2 #2-#3 "핵심 메커니즘"** | **유지 (축약)** | **블로그 본문의 메인**. ASCII 다이어그램 → Mermaid 또는 1-2개만 남기고 나머지는 글로. 서브섹션은 H3으로 유지하되 3개 이하로. |
| `💻 실전 실험` | **생략** | **생략** | 블로그에 실행 스크립트 넣지 않는다. 원한다면 링크 한 줄: "직접 실행해보려면 [repo](url) 참고". |
| `📊 성능 비교` | **H2 #4 "트레이드오프" 안의 한 단락** | **축약** | 수치 1-2개만 대표로. 표 전체 옮기지 않는다. |
| `⚖️ 트레이드오프` | **H2 #4 "트레이드오프"** 또는 `<Callout>` | **유지** | **절대 생략 금지**. 블로그 DNA의 핵심. Callout 박스 또는 H2 하나 통째로. |
| `📌 핵심 정리` | **H2 #5 "정리"** | **축약** | bullet 3-4개 또는 한 단락. 10개 전부 나열 금지. |
| `🤔 생각해볼 문제` | **생략** | **생략** | 블로그엔 적합하지 않음. 원본 레포 링크로 유도. |

### 4.2 블로그 5-H2 골격 확정

```
[인트로: H2 없음, 2-3 문장]
  ├─ 문장 1: 주제 + 익숙한 정의
  └─ 문장 2-3: "왜?" 질문 직격

## 1. [설정/출발점]           ← 맥락 1문단 + 정의
## 2. [핵심 메커니즘]         ← 본론. 코드/수식. 가장 길게.
## 3. [문제 또는 함의]        ← Theorem/Proof 또는 Callout
## 4. [트레이드오프 또는 확장] ← Collapse 또는 Aside
## 5. 정리                    ← 3-4 bullet 또는 1단락 + (선택) 다음 글 예고
```

**H2 제목 생성 규칙**:
- ✅ "프록시 기반 설계의 출발점" (명사형)
- ✅ "문제: 내적의 분산 폭발" (문제 명시형)
- ✅ "해결: 분산을 1로 정규화" (해결 명시형)
- ❌ "소개", "개요", "본론" 같은 무미건조 단어 금지
- ❌ 원본의 이모지(🎯🔍😱✨🔬) 전부 제거. 블로그 H2에는 이모지 없다.

### 4.3 톤 전환 가이드 (before/after)

| 원본 (딥다이브) | 변환 (블로그) | 규칙 |
|:---|:---|:---|
| "이 문서를 읽고 나면 다음 질문에 답할 수 있습니다." | [완전 삭제] | 메타 문구 제거 |
| "~합니다" / "~입니다" | "~한다" / "~이다" | **경어체 → 평서체** |
| "Redis는 단일 스레드인데 왜 수만 개의 동시 연결을 처리할 수 있는가?" | "Redis는 단일 스레드다. 그런데 수만 개의 동시 연결을 어떻게 처리하는가?" | 긴 질문 → 2문장으로 쪼개 리듬 만들기 |
| "100만 개 키에 KEYS * → 이벤트 루프 수백 ms 독점" | "`KEYS *`는 이벤트 루프를 수백 ms 독점한다. 그 시간 동안 다른 모든 요청이 멈춘다." | 화살표·축약 표기 → 완전한 문장 |
| 서브섹션 H3 6개 | H3 2-3개 + 나머지는 본문에 녹임 | 계층 축소 |
| "각 항 $q_i k_i$의 평균과 분산을 계산하면:" | "각 항 $q_i k_i$의 평균과 분산을 계산하자." | 기대 유발어("~하면") → 의도 명시어("~하자") |

### 4.4 제목(title)과 slug 생성 규칙

**title**:
- 질문형 또는 명제형 한국어
- 20-40자
- 원본 문서의 `# H1` 이 "단일 스레드 이벤트 루프 — 왜 빠른가" 처럼 이미 질문형이면 그대로 다듬어 사용
- 원본이 사실 나열형이면 변환:
  - 원본: "Redis의 메모리 관리"
  - 변환: "Redis는 메모리를 어떻게 관리하는가"

**slug**:
- 영문 kebab-case, 20-50자
- 규칙: `<technology>-<concept>-<mechanism>`
- 예시 매핑:
  - 원본 제목 "단일 스레드 이벤트 루프 — 왜 빠른가" → slug `redis-single-thread-event-loop`
  - 원본 제목 "Attention의 √d 스케일링" → slug `attention-sqrt-d-scaling`
- 레포 이름을 prefix로 쓰지 않는다 (`redis-deep-dive-01-...` 금지). 주제 중심.

### 4.5 Frontmatter 자동 생성 규칙 (결정적)

| 필드 | 생성 규칙 |
|:---|:---|
| `title` | §4.4 |
| `description` | 원본의 `🔍 왜 이 개념이 실무에서 중요한가` 첫 문단 + `🎯 핵심 질문`의 핵심 1개를 합쳐 1문장(120-180자)으로 압축. "...부터 ...까지" 패턴 권장. |
| `pubDate` | 에이전트 실행 시점의 날짜 (YYYY-MM-DD, Asia/Seoul) |
| `category` | 소스 repo가 `iq-dev-lab/*` → `dev`, `iq-ai-lab/*` → `ai` |
| `tags` | §1.5. 3-5개. 레포 이름에서 1개(`redis`) + 챕터 주제에서 1-2개(`event-loop`, `io-multiplexing`) + 메커니즘에서 1-2개(`epoll`, `single-thread`) |
| `series.slug` | 레포 이름에서 `-deep-dive` 제거 후 kebab-case. 예: `redis-internals`. [확인 필요] 레포의 챕터 폴더명을 쓸지 전체 레포명을 쓸지. |
| `series.title` | 레포 README의 H1에서 "Deep Dive" 제거. 예: `"Redis Internals"` |
| `series.order` | 원본 파일명 앞 번호. `01-single-thread-event-loop.md` → `1` |
| `difficulty` | 원본에 수식 블록(`$$`) 3개 이상 → `advanced`. Theorem/Proof 언급 → `advanced`. 아니면 `intermediate`. |
| `draft` | **항상 `true`** (에이전트는 초안만). |
| `featured` | **항상 `false`**. |
| `updatedDate` | 생략. |
| `heroImage`, `heroAlt` | 생략 (Satori 자동). |

### 4.6 코드블록 처리 규칙

**언어 태그 필수**. 원본에 없으면 내용 추론해서 부여.

| 상황 | 태그 | 예시 |
|:---|:---|:---|
| Java 코드 | ` ```java ` | `@Transactional public void...` |
| Python 코드 | ` ```python ` | `import torch...` |
| Shell 명령 | ` ```bash ` | `$ redis-cli SLOWLOG GET 10` |
| Redis 명령/응답 | ` ```bash ` (Shiki에 redis 없음) | `KEYS *` → `bash` 태그 |
| SQL | ` ```sql ` | `SELECT * FROM ...` |
| YAML 설정 | ` ```yaml ` |  |
| 순수 텍스트 다이어그램 | ` ``` ` (태그 없음) | ASCII art |
| 일반 설명·의사코드 | ` ``` ` (태그 없음) | `플로우: A → B → C` |

**파일명 주석**:
- 첫 줄에 해당 언어의 주석으로 `파일경로` 명시
- Java: `// UserService.java`
- Python: `# train.py`
- YAML: `# config.yaml`
- 원본 코드가 전체 파일이 아니면 주석 없이 바로 시작

### 4.7 이미지·다이어그램 경로 변환 규칙

**이미지 (드물게 존재)**:

| 원본 위치 | 변환 위치 | 참조 방식 |
|:---|:---|:---|
| `<repo>/docs/*.png` | `iq-proof/public/images/<slug>/*.webp` | `![alt](/images/<slug>/*.webp)` 또는 `<Figure />` |
| **외부 URL** | 그대로 외부 URL 유지 | 이미지 복사하지 않음 |

**원본이 PNG/JPG여도 변환 시 WebP로 변환 권장** [확인 필요 — 실제 이미지 최적화 파이프라인이 있는지]

**다이어그램 (매우 자주)**:

원본 딥다이브엔 ASCII 다이어그램이 풍부하다 (예: Redis 이벤트 루프 박스 그림). 변환 규칙:

1. **작고 단순한 플로우** (3-5 노드, 단방향) → **Mermaid**로 변환
   ```mermaid
   graph LR
     A[클라이언트] --> B[이벤트 루프]
     B --> C[epoll_wait]
   ```

2. **큰 ASCII 아트** (박스 그림, 구조도) → **그대로 코드블록 안에 유지** (태그 없음)
   ```
   ┌──────────────────────────┐
   │  이벤트 루프 (ae.c)       │
   ...
   ```

3. **너무 긴 ASCII (30줄 이상)** → **2-3개로 쪼개거나** → **간단한 Mermaid로 대체 + "상세 그림은 [repo](url) 참고"**

**Mermaid 지원 확인**: `@astrojs/mdx` 기본에는 Mermaid 렌더링 없음. [확인 필요 — `rehype-mermaid` 또는 `astro-mermaid` 도입 여부]. 도입 전이면 **모든 다이어그램은 코드블록 방식 유지**.

### 4.8 MDX 컴포넌트 주입 규칙 (결정적)

에이전트는 출력 MDX 본문에 **반드시** 다음을 포함한다:

```mdx
---
{frontmatter}
---

import Callout from '@/components/mdx/Callout.astro';
import Theorem from '@/components/mdx/Theorem.astro';
import Proof from '@/components/mdx/Proof.astro';
import Aside from '@/components/mdx/Aside.astro';
{category === 'ai' ? "import Reference from '@/components/mdx/Reference.astro';" : ""}
{"복잡한 해결책 3개 이상 있으면 import Collapse from '@/components/mdx/Collapse.astro';"}

[본문]
```

**컴포넌트 배치 가이드**:

| 원본에 있는 것 | 블로그에 넣을 것 | 위치 |
|:---|:---|:---|
| 트레이드오프 표 | `<Callout type="note" title="트레이드오프">` | H2 #4 안 |
| 경고/함정 | `<Callout type="warning" title="...">` | 해당 주제 직후 |
| 수학적 주장 | `<Theorem kind="lemma" number="1" title="...">` + `<Proof>` | H2 #2-#3 안. **AI 포스트 거의 필수**, Dev는 선택. |
| 사이드 인사이트 | `<Aside label="...">` | 본문 흐름 끊지 않는 위치. 포스트당 1개. |
| 3개 이상 해결책 나열 | 각각 `<Collapse title="해결책 N — ...">` | H2 #4 안 |
| 논문·외부 자료 참고 | `<Reference ... />` | **포스트 맨 끝**. AI 포스트는 1-2개 권장. Dev 포스트는 선택. |

---

## 5. 확인 필요 항목 정리

다음은 [확인 필요] 태그된 항목들이다. 에이전트 본격 가동 전 결정.

1. **series.slug 정책**: 레포 전체(`redis-deep-dive`) vs 챕터 폴더명(`redis-internals`). 후자 권장하나 레포 구조 의존적.
2. **이미지 최적화**: WebP 변환 파이프라인 존재 여부. 없으면 PNG 그대로.
3. **Mermaid 지원**: `astro-mermaid` 또는 동등 플러그인 설치 여부. 없으면 모든 다이어그램은 코드블록.
4. **시리즈 간 연결**: 동일 레포의 여러 챕터를 동일 `series.slug` 묶을지, 다른 시리즈로 나눌지. 권장: **레포 = 1 시리즈** 대신 **챕터 폴더 = 1 시리즈**.
5. **draft 브랜치 정책**: 에이전트가 포스트당 별도 PR을 만들지, 챕터 묶음으로 하나의 PR을 만들지. 권장: **레포당 1개 PR, 7-10 파일 포함**.
