# iq-blogger — Few-Shot Examples

실제 블로그 포스트를 "역공학"하여 뽑아낸 변환 페어 3개. 각 페어는 **딥다이브 원본에 있었을 법한 입력 → 블로그에 실제로 존재하는 출력** 형태로 구성.

---

## Example 1 — Dev / Intermediate (Spring AOP)

### INPUT (simulated deep-dive excerpt)

```
SOURCE_REPO: iq-dev-lab/spring-core-deep-dive
SOURCE_PATH: aop-internals/01-proxy-based-design.md
CHAPTER_ORDER: 1
CHAPTER_TITLE: Spring AOP Internals
RUN_DATE: 2026-04-17
---

# 프록시 기반 AOP — Self-invocation 문제의 뿌리

## 🎯 핵심 질문

이 문서를 읽고 나면 다음 질문에 답할 수 있습니다.

- Spring은 왜 AspectJ 대신 런타임 프록시를 선택했는가?
- 같은 클래스 안에서 메서드 호출 시 AOP가 왜 적용되지 않는가?
- JDK Dynamic Proxy와 CGLIB은 어떻게 다른가?
- Self-invocation을 해결하는 세 가지 방법의 트레이드오프는?

## 🔍 왜 이 개념이 실무에서 중요한가

@Transactional이 적용되지 않아 트랜잭션 경계가 엉키는 버그의 대부분은 self-invocation 때문입니다. 프록시 AOP의 작동 원리를 이해하지 못하면, 이런 버그를 만났을 때 "왜 나만 안 되지?"라는 막연한 혼란에 빠지게 됩니다.

## 🔬 내부 동작 원리

### 1. 프록시의 생성
Spring은 IoC 컨테이너가 빈을 생성할 때, AOP 대상이 되는 빈을 프록시로 감쌉니다...

### 2. 호출 경로
클라이언트가 orderService.placeOrder()를 호출할 때...

### 3. Self-invocation의 발생
원본 placeOrder() 안에서 this.save()를 호출하면...

## ⚖️ 트레이드오프

프록시 방식:
- 장점: JVM 표준 메커니즘, 이식성 높음, 설정 단순
- 단점: self-invocation 문제, final 제약, 성능 오버헤드

AspectJ Weaving:
- 장점: self-invocation 해결, final 제약 없음
- 단점: 빌드 복잡도, 시작 시간 증가, 디버깅 어려움

## 📌 핵심 정리

- 프록시 AOP는 Spring의 "최소 침습" 철학의 귀결
- Self-invocation은 버그가 아니라 설계의 결과
- JDK Proxy는 인터페이스 기반, CGLIB은 상속 기반
- 해결책 3가지 (자기 주입, 클래스 분리, AspectJ 전환) 각각 비용이 다름
```

### OUTPUT (actual blog post)

```mdx
---
title: "Spring AOP는 왜 프록시 기반일까"
description: "Self-invocation 문제의 근본 원인부터 AspectJ Weaving과의 트레이드오프까지, 프록시 AOP의 설계 결정을 추적한다."
pubDate: 2026-04-17
category: dev
tags: [spring, aop, proxy, jvm]
difficulty: intermediate
series:
  slug: spring-aop-internals
  title: Spring AOP Internals
  order: 1
draft: true
featured: false
---

import Callout from '@/components/mdx/Callout.astro';
import Theorem from '@/components/mdx/Theorem.astro';
import Proof from '@/components/mdx/Proof.astro';
import Aside from '@/components/mdx/Aside.astro';
import Collapse from '@/components/mdx/Collapse.astro';

Spring AOP는 **런타임 프록시**를 기반으로 동작한다. AspectJ의 컴파일타임/로드타임 위빙과 달리, Spring은 대상 빈을 감싸는 프록시 객체를 생성해 어드바이스를 끼워 넣는다. 왜 이 선택을 했을까? 그리고 이 선택이 `this.method()` 호출에서 AOP가 무시되는 **self-invocation 문제**를 어떻게 만들어내는가?

## 프록시 기반 설계의 출발점

Spring이 프록시 방식을 선택한 이유는 **"Spring이라는 프레임워크의 제약 안에서 가장 덜 침습적인 AOP"**를 구현하기 위해서다. AspectJ Weaving을 쓰려면 컴파일러를 바꾸거나 (compile-time weaving) 클래스로더를 조작해야 (load-time weaving) 한다. Spring은 "IoC 컨테이너가 빈을 생성할 때 한 번만 개입한다"는 철학을 지키기 위해 프록시를 택했다.

<Callout type="note" title="트레이드오프">
프록시 방식은 **JVM 표준 메커니즘**만 사용하므로 이식성이 높다. 대신 self-invocation 문제와 `final` 클래스/메서드 불가 같은 제약이 따라붙는다.
</Callout>

## Self-Invocation 문제

[... 중략, 본문 참조 ...]

<Theorem kind="proposition" number="1" title="Self-invocation AOP bypass">
프록시 기반 AOP에서, 같은 클래스의 메서드끼리 `this` 참조로 호출하면 어드바이스가 적용되지 않는다.
</Theorem>

<Proof>
[... 증명 ...]
</Proof>

## 정리

프록시 AOP의 self-invocation 문제는 **버그가 아니라 설계의 귀결**이다. Spring은 JVM 메커니즘 내에서 동작하는 비침습적 AOP를 선택했고, 그 대가로 `this` 참조가 프록시를 우회한다. 이 트레이드오프를 알고 쓰는 것과 모르고 쓰는 것은 완전히 다르다.

다음 글에서는 CGLIB가 `final` 메서드를 어떻게 처리하는지, 그리고 왜 Spring Boot 2.0부터 CGLIB가 기본값이 됐는지 추적한다.
```

### Transformation notes

- 제목 `프록시 기반 AOP — Self-invocation 문제의 뿌리` → `Spring AOP는 왜 프록시 기반일까` (질문형으로)
- `🎯 핵심 질문` 4개 중 가장 날카로운 1개만 인트로 마지막 질문으로
- `🔍 왜 중요한가`의 @Transactional 트랜잭션 경계 → 인트로 1문장에 압축
- `🔬 내부 동작 원리`의 H3 3개를 "프록시 기반 설계의 출발점" + "Self-Invocation 문제" 두 H2로 재편
- 트레이드오프는 `<Callout type="note" title="트레이드오프">`로 압축
- `📌 핵심 정리` bullet 4개 → 마지막 "정리" 섹션에서 한 단락 + 다음 글 예고로
- `💻 실전 실험`, `🤔 생각해볼 문제` 완전 생략

---

## Example 2 — AI / Advanced (Attention scaling)

### INPUT (simulated deep-dive excerpt)

```
SOURCE_REPO: iq-ai-lab/transformer-deep-dive
SOURCE_PATH: attention-mechanism/03-scaled-dot-product.md
CHAPTER_ORDER: 3
CHAPTER_TITLE: Attention Mechanism
RUN_DATE: 2026-04-15
---

# Scaled Dot-Product Attention의 √d_k 정규화

## 🎯 핵심 질문

- 왜 attention 수식에서 QK^T를 √d_k로 나누는가?
- 이 정규화가 없으면 구체적으로 무엇이 망가지는가?
- 분산이 d_k가 되는 과정을 수학적으로 유도할 수 있는가?
- Linear Attention은 이 정규화를 어떻게 우회하는가?

## 🔍 왜 이 개념이 실무에서 중요한가

Transformer의 핵심 수식인 attention에서 √d_k 나누기는 종종 "그냥 관행"처럼 받아들여집니다. 하지만 이 작은 상수 하나가 학습 안정성을 결정합니다. 차원이 커질수록 문제가 커지는 이유를 알면, Layer Normalization이나 Xavier Initialization 같은 다른 스케일링 기법의 동기도 같은 프레임으로 이해하게 됩니다.

## 🔬 내부 동작 원리

### 1. 내적의 분산 계산
q, k가 독립이고 평균 0, 분산 1일 때...

### 2. Softmax 포화
Softmax는 큰 입력값에서 그래디언트가 급격히 작아집니다...

### 3. √d_k 정규화의 효과
분산이 d_k라면, √d_k로 나누면 분산이 1로 돌아갑니다...

## ⚖️ Linear Attention과의 비교

Performer 계열은 이 스케일링을 커널 트릭으로 우회합니다...

## 📌 핵심 정리

- QK^T의 분산은 d_k에 비례
- 큰 분산 → Softmax 포화 → 그래디언트 소실
- √d_k 나눔 → 분산 1로 정규화
- Linear Attention도 같은 원칙을 다른 방식으로 보존
```

### OUTPUT (actual blog post)

```mdx
---
title: "Attention의 √d 스케일링은 어디서 왔나"
description: "Scaled dot-product attention의 분모 √d_k가 왜 필요한가. Softmax 포화를 막기 위한 분산 보존 유도와 Linear Attention의 가정까지."
pubDate: 2026-04-15
category: ai
tags: [transformer, attention, softmax, variance]
difficulty: advanced
series:
  slug: attention-mechanism
  title: Attention Mechanism
  order: 3
draft: true
featured: false
---

import Callout from '@/components/mdx/Callout.astro';
import Theorem from '@/components/mdx/Theorem.astro';
import Proof from '@/components/mdx/Proof.astro';
import Reference from '@/components/mdx/Reference.astro';
import Aside from '@/components/mdx/Aside.astro';

Transformer 논문에서 attention은 다음과 같이 정의된다.

$$
\text{Attention}(Q, K, V) = \text{softmax}\left(\frac{QK^\top}{\sqrt{d_k}}\right) V
$$

왜 하필 $\sqrt{d_k}$로 나누는가? 단순히 "실험적으로 잘 되더라"가 아니라, **Softmax 포화(saturation)를 막기 위한 분산 보존**이라는 구체적인 이유가 있다.

## 문제: 내적의 분산 폭발

[... Lemma + Proof ...]

## 왜 이게 문제인가: Softmax 포화

[... Callout type="warning" ...]

## 해결: 분산을 1로 정규화

[... 해결 수식 ...]

## Linear Attention의 가정

[... 커널 트릭 ...]

<Aside label="직관">
모든 딥러닝 정규화(BatchNorm, LayerNorm, weight init scaling)는 결국 같은 동기를 공유한다 — *신호가 깊이 방향으로 확산되거나 소멸하지 않도록 분산을 제어하라*. $\sqrt{d_k}$ 스케일링도 같은 철학의 작은 사례다.
</Aside>

## 정리

- $QK^\top$의 분산은 차원 $d_k$에 선형 비례한다.
- 큰 분산은 Softmax 포화를 유발해 그래디언트를 죽인다.
- $\sqrt{d_k}$로 나누면 분산이 1로 정규화되어 학습이 안정된다.
- 이 원칙은 Linear Attention 계열에도 다른 형태로 이어진다.

수식 한 줄 뒤에는 "그래디언트를 살려야 한다"는 구체적인 엔지니어링 요구가 숨어 있다.

<Reference
  title="Attention Is All You Need"
  authors="Vaswani et al."
  year={2017}
  venue="NeurIPS"
  url="https://arxiv.org/abs/1706.03762"
/>
```

### Transformation notes

- `📌 핵심 정리`의 4개 bullet → 정리 섹션에 그대로 유지 (수학 포스트는 bullet 정리가 더 명확)
- `🔬 내부 동작 원리`의 H3 3개 → 문제/왜 문제인가/해결 3개 H2로 분리
- `⚖️ Linear Attention과의 비교` → H2 "Linear Attention의 가정"으로 변경
- 수학 포스트에는 `<Aside>` 한 번, `<Reference>` 1-2개 추가 (원본엔 없지만 블로그 스타일)
- 마지막 문장 "수식 한 줄 뒤에는..." 은 정리 이후의 **핵심 한 줄 마무리** (블로그 특유의 패턴)

---

## Example 3 — Dev / Intermediate (Redis single-thread)

### INPUT (actual deep-dive excerpt)

```
SOURCE_REPO: iq-dev-lab/redis-deep-dive
SOURCE_PATH: redis-internals/01-single-thread-event-loop.md
CHAPTER_ORDER: 1
CHAPTER_TITLE: Redis Internals
RUN_DATE: 2026-04-21
---

# 단일 스레드 이벤트 루프 — 왜 빠른가

## 🎯 핵심 질문

- Redis는 단일 스레드인데 왜 수만 개의 동시 연결을 처리할 수 있는가?
- epoll/kqueue I/O 멀티플렉싱은 select와 어떻게 다르고, 왜 빠른가?
- 단일 스레드임에도 Redis가 빠른 이유는 무엇이고, 어디서 병목이 발생하는가?
- KEYS *, SMEMBERS, LRANGE 0 -1 같은 명령어가 위험한 이유는?

## 🔍 왜 이 개념이 실무에서 중요한가

Redis는 단일 스레드임에도 수만 개의 동시 연결을 처리한다. 이 구조가 어떻게 작동하는지 이해하지 못하면, 특정 명령어 하나가 전체 서비스를 멈추는 이유를 영원히 파악할 수 없다.

## 😱 흔한 실수 (Before)

상황: Redis 응답 시간이 갑자기 수백 ms로 치솟음
잘못된 판단: "Redis가 느려졌다 → 인스턴스 업그레이드"
실제 원인: KEYS * 가 이벤트 루프 수백 ms 독점

## 🔬 내부 동작 원리

### 1. 전통적 멀티스레드 vs 이벤트 루프
### 2. epoll의 동작 원리
### 3. Redis의 선택

## ⚖️ 트레이드오프
단일 스레드: CPU 바운드 작업에 취약
멀티스레드: 컨텍스트 스위칭 오버헤드
...
```

### OUTPUT (generated per agent rules)

```mdx
---
title: "Redis는 단일 스레드인데 왜 빠른가"
description: "수만 개의 동시 연결을 단일 스레드로 처리하는 이벤트 루프의 원리부터 KEYS *가 치명적인 이유까지, 병목의 정체를 추적한다."
pubDate: 2026-04-21
category: dev
tags: [redis, event-loop, epoll, single-thread]
difficulty: intermediate
series:
  slug: redis-internals
  title: Redis Internals
  order: 1
draft: true
featured: false
---

import Callout from '@/components/mdx/Callout.astro';
import Aside from '@/components/mdx/Aside.astro';

Redis는 단일 스레드다. 그런데 수만 개의 동시 연결을 지연 없이 처리한다. 어떻게 가능한가? 그리고 왜 `KEYS *` 한 줄이 전체 서비스를 몇 초간 멈출 수 있는가?

## 이벤트 루프의 출발점

전통적인 멀티스레드 서버는 연결마다 스레드를 할당한다. 10,000 연결이면 10,000 스레드. 각 스레드가 소켓 데이터를 기다리며 블록되므로, 스레드 메모리(1~8MB/스레드)와 컨텍스트 스위칭 비용이 연결 수에 선형으로 쌓인다.

Redis는 정반대 선택을 한다 — **단일 스레드가 모든 연결을 순회하되, I/O 대기는 OS에 위임**한다. 대기 시간이 0이면, 한 스레드로도 수만 연결을 처리할 수 있다.

## epoll — 준비된 것만 돌려주는 OS

Linux의 `epoll`은 이 전략의 핵심 도구다.

```bash
# select: 매 호출마다 fd 목록 전체를 커널에 복사, 전체 스캔 (O(N))
select(max_fd + 1, &readfds, NULL, NULL, &timeout);

# epoll: 관심 소켓을 한 번 등록, 커널이 준비된 것만 반환 (O(1))
epoll_wait(epfd, events, MAX_EVENTS, -1);
```

`epoll_wait`는 "읽기/쓰기 준비된 소켓이 생길 때까지 대기" 한 후 준비된 fd만 반환한다. Redis는 이 fd 목록만 순회해 핸들러를 호출한다. CPU는 항상 실제 작업에만 쓰인다.

## 단일 차선 도로의 대가

이 구조의 핵심 제약이 여기서 나온다.

<Callout type="warning" title="이벤트 루프 = 단일 차선 도로">
한 번에 한 명령어만 통과한다. `KEYS *`가 100만 개 키를 순회하는 동안, 다른 모든 요청은 큐에서 기다린다. 그 시간이 수백 ms면, 수백 ms 동안 서비스 전체가 멈춘다.
</Callout>

`O(N)` 명령어는 이 구조에서 항상 위험하다. `KEYS *` → `SCAN`, `SMEMBERS` → `SSCAN`, `HGETALL` → `HSCAN`. 커서 기반으로 쪼개 처리하면 이벤트 루프를 독점하지 않는다.

## 트레이드오프

단일 스레드의 대가는 명확하다. **CPU 바운드 작업에 취약**하다. Lua 스크립트 안의 무거운 연산, 정렬이 필요한 `SORT` 명령, 암호화 연산 — 전부 이벤트 루프를 점유한다. Redis 6.0부터 I/O 스레드를 추가한 Threaded I/O는 이 한계를 부분적으로 완화하지만, 명령 실행 자체는 여전히 단일 스레드다.

<Aside label="설계 철학">
Redis의 "단일 스레드"는 게으름이 아니라 선택이다. 락, 원자성, 컨텍스트 스위칭 오버헤드를 전부 피하면서 수만 연결을 다루는 균형점. 대신 사용자에게 "긴 명령 금지"라는 명확한 책임을 요구한다.
</Aside>

## 정리

- Redis는 이벤트 루프 + `epoll`로 I/O 대기 시간을 0으로 만든다.
- 단일 스레드는 병목이 아니라 설계다. 병목은 사용자가 O(N) 명령어를 쓸 때 생긴다.
- `SLOWLOG GET 20`으로 느린 명령을 식별하고, `SCAN` 계열로 교체하라.

다음 글에서는 Redis가 이 단일 스레드 내에서 메모리를 어떻게 관리하는지, 그리고 `maxmemory-policy`의 각 정책이 어떤 계산 기반인지 추적한다.
```

### Transformation notes

- 원본 제목 "단일 스레드 이벤트 루프 — 왜 빠른가" → 주체 명시한 "Redis는 단일 스레드인데 왜 빠른가"
- `🎯 핵심 질문` 4개 → 인트로의 2개 질문으로 압축
- `😱 흔한 실수`의 시나리오 → 본문 마지막 Callout에 "KEYS * → 수백 ms 독점"으로 녹여 넣음
- `🔬 내부 동작 원리`의 H3 3개 → "이벤트 루프의 출발점" + "epoll — 준비된 것만 돌려주는 OS" 2개 H2로
- `⚖️ 트레이드오프` → H2 "트레이드오프" 유지 + `<Aside label="설계 철학">` 추가
- `📌 핵심 정리` bullet 4개 → bullet 3개 + 다음 글 예고 한 줄
- `💻 실전 실험`, `📊 성능 비교`, `🤔 생각해볼 문제` 완전 생략
- 단어 수: 약 310 단어 (목표 300±30 준수)
- H2 개수: 5개 (인트로 + 이벤트 루프의 출발점 + epoll + 트레이드오프 + 정리 = 정확히 5)

---

## 핵심 학습 지점

1. **원본 10섹션 → 블로그 5 H2**. 거의 항상 `💻`, `🤔`는 삭제, `📊`는 한 단락으로 녹음.
2. **tradeoff 섹션은 무조건 유지** (H2 또는 Callout).
3. **제목은 반드시 질문형/명제형**으로 변환.
4. **경어체 → 평서체** 기계적 변환.
5. **마지막은 "한 줄 인사이트" 또는 "다음 글 예고"**. 장황한 요약 금지.
6. **MDX 컴포넌트는 실제 사용할 때만 import**. AI 포스트는 `<Theorem>/<Proof>/<Reference>` 거의 필수, Dev 포스트는 선택.
