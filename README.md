# vmc-admin-starter

Next.js 16 App Router + SQLite 기반 업무 자동화 도구 스캐폴딩 템플릿.

여기서 시작해서 원하는 내부 도구를 바이브코딩으로 만든다.

---

## 시작하기

```bash
npm install
npm run dev   # http://localhost:3001
```

---

## 구조

```
schema.sql          — DB 스키마 (앱 시작 시 자동 실행)
lib/db.ts           — SQLite 싱글톤
types/index.ts      — 타입 정의
components/ui/      — Badge, Button, Card, NavLink
app/layout.tsx      — 사이드바 레이아웃
app/page.tsx        — 시작 페이지
```

### 3-tier 아키텍처

```
Presentation  →  app/[page]/page.tsx
Application   →  app/api/[route]/route.ts
Infrastructure→  lib/db.ts + schema.sql
```

`CLAUDE.md`에 전체 아키텍처 규칙이 있습니다.

---

## 새 기능 만들기

1. `schema.sql` — 테이블 추가
2. `types/index.ts` — 타입 추가
3. `app/api/[name]/route.ts` — API route 작성
4. `app/[name]/page.tsx` — 페이지 작성
5. `app/layout.tsx` — nav 항목 추가

---

## 기술 스택

- **Next.js 16** App Router (React 19)
- **SQLite** — `better-sqlite3`, 로컬 파일 DB
- **Claude CLI** — `claude -p`로 AI 기능 추가
- **Tailwind CSS 4** — 모노크롬 디자인 시스템

---

## 완성 예시

`sample` 브랜치 — 이 템플릿에서 출발해 만든 **PG 가맹점 위험도 AI 분석 시스템**.

```bash
git checkout sample
npm run dev
```
