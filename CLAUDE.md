# CLAUDE.md

> Claude Code가 이 코드베이스를 작업할 때 반드시 읽는 파일입니다.

## 기본 지시

- **항상 한국어로 응답한다.**

## 이 프로젝트란

Next.js 16 App Router + SQLite 기반 업무 자동화 도구 스캐폴딩 템플릿.
여기서 시작해서 원하는 내부 도구를 만든다.

## 아키텍처 (3-tier)

```
Presentation   →  app/[page]/page.tsx         (Server 또는 Client Component)
Application    →  app/api/[route]/route.ts    (Next.js Route Handler)
Infrastructure →  lib/db.ts + schema.sql      (SQLite via better-sqlite3)
```

### 레이어 규칙

| 레이어 | 위치 | 규칙 |
|--------|------|------|
| Presentation | `app/[page]/page.tsx` | UI 렌더링만. 비즈니스 로직 없음. |
| Application | `app/api/*/route.ts` | DB 접근 + 응답 구성. `'use client'` 없음. |
| Infrastructure | `lib/db.ts` | SQLite 싱글톤. 직접 수정 불필요. |

**핵심 규칙**: `getDB()`는 `'use client'` 컴포넌트에서 절대 호출하지 않는다.

## 파일 구조

```
schema.sql          — DB 스키마 정의 (앱 시작 시 자동 실행)
lib/db.ts           — SQLite 싱글톤 (getDB 함수)
types/index.ts      — 전체 타입 단일 관리
components/ui/      — 재사용 UI 컴포넌트 (Badge, Button, Card, NavLink)
app/layout.tsx      — 사이드바 쉘 + 네비게이션
app/page.tsx        — 홈 페이지 (여기서 시작)
```

## 새 기능 추가 순서

1. `schema.sql` — 테이블 정의
2. `types/index.ts` — 타입 정의
3. `app/api/[name]/route.ts` — API route (GET, POST, PATCH, DELETE)
4. `app/[name]/page.tsx` — 페이지
5. `app/layout.tsx` — nav에 링크 추가

## AI 기능 추가 패턴

```typescript
// app/api/ai/[name]/route.ts
import { spawn } from 'child_process';

const claude = spawn('claude', ['-p', prompt], { stdio: ['pipe', 'pipe', 'pipe'] });
claude.stdin?.end();

const stream = new ReadableStream({
  start(controller) {
    claude.stdout?.on('data', (chunk) => {
      controller.enqueue(encoder.encode(`data: ${chunk}\n\n`));
    });
    claude.on('close', () => controller.close());
  },
});

return new Response(stream, {
  headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
});
```

## UI 컴포넌트 사용법

```tsx
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';

<Badge color="green">완료</Badge>
<Button variant="primary">저장</Button>
<Card title="섹션 제목">내용</Card>
```

## 안티패턴 (하지 말 것)

- JSX 섹션 레이블 주석 `{/* ─── 폼 영역 ─── */}`
- 코드가 이미 설명하는 주석 `// 버튼 클릭 핸들러`
- `'use client'` 컴포넌트에서 `getDB()` 직접 호출
- 같은 타입을 여러 파일에 중복 정의

## 완성 예시

`sample` 브랜치 — PG 가맹점 위험도 분석 AI 에이전트 시스템 구현체.
이 템플릿에서 출발해 동일한 아키텍처로 만든 실제 작동하는 앱.
