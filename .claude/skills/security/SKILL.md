---
name: security
description: Whole-codebase security audit for apps built on this template (business-management / automation systems) — PII handling, encryption, secrets, access control, and preventing sensitive data from leaking through API responses (the browser Network tab) or the UI. Combines static data-flow analysis with a runtime pass that drives the running app, then reports severity-ranked findings. Report only — never auto-fixes. Use when the user wants a security / privacy review, or asks to check for data exposure.
disable-model-invocation: true
---

A thorough, two-mode security audit of the **whole codebase**. The goal is to find every place sensitive data could leak or be mishandled — with particular attention to data that must never reach the client: anything that should stay server-side but shows up in an **API response (visible in the browser Network tab)** or in the **rendered UI / page markup**.

This skill **reports only**. It never edits code or applies fixes — security changes must be reviewed by a human. Every finding carries a severity and concrete remediation guidance.

## What counts as sensitive (baseline)

Always treat these as sensitive unless the codebase clearly documents otherwise:

- **Personal data (PII)** — names, emails, phone numbers, addresses / locations, customer or company identities, anything that identifies a person or client.
- **Business-confidential** — deal/estimate values and other amounts, internal notes, client lists.
- **Credentials & secrets** — passwords and hashes, API keys, tokens, session identifiers, DB connection strings, third-party credentials.
- **Enumerable internal identifiers** — sequential IDs or other handles that let one user reach another user's records.

The codebase may define its own taxonomy (e.g. a masking config) — fold that in, but never let it shrink this baseline.

## Dimensions

Audit every one of these — none may be skipped:

1. **API / Network-tab exposure** — does any endpoint return sensitive data in its response body? When a masking/redaction feature exists, masking must be applied **server-side before the response is serialized**, on **every endpoint and every field**. Raw data that is "hidden in the UI" but still present in the JSON is a leak.
2. **Client-bundle & UI exposure** — secrets or PII reaching the browser via `NEXT_PUBLIC_*` env vars, props passed to Client Components, the RSC / `__NEXT_DATA__` payload, or data that is visually hidden (CSS, `display:none`) but present in the DOM/HTML.
3. **Third-party egress** — sensitive data sent to external services (AI/LLM calls, email, webhooks, analytics) without minimization or masking.
4. **Secrets & data-at-rest** — hardcoded secrets; `.env*` files and database files (e.g. SQLite `*.db`) not git-ignored; sensitive columns stored in plaintext where field-level encryption is warranted.
5. **Authentication & authorization (incl. IDOR)** — is every record access scoped to the requesting user? Missing or broken access control lets one user read or mutate another's data — the top risk for multi-user business apps. Flag the **absence** of authz, not just bugs within it.
6. **Injection & input validation** — dynamically-built or unparameterized SQL, `dangerouslySetInnerHTML` / unsanitized HTML (XSS), unvalidated request bodies and query params.
7. **Transport & crypto** — passwords hashed with a strong algorithm (never plaintext / `md5` / `sha1`), HTTPS assumed in production, secure cookie flags, no weak or home-rolled crypto.

## Process

### 1. Map the codebase and data flows

Read the project to build a map: entry points (API routes, server actions, pages), where sensitive data originates (DB tables/columns, request inputs), and where it flows out (responses, rendered output, third-party calls). Note any existing masking/redaction/auth mechanism and how it is toggled. This map seeds both passes below.

### 2. Static pass — parallel dimension sub-agents

Spawn the dimension audits as **parallel sub-agents** (one per dimension, `general-purpose`) so they don't pollute each other's context. Give each sub-agent:

- The data-flow map from step 1 and the file list to read.
- The sensitive-data baseline above, pasted in full — the sub-agent has no other access to it.
- Its single dimension's brief, plus: "Report each finding as — severity (Critical/High/Medium/Low) · location (file:line, endpoint, or page) · what leaks or fails, concretely · how to fix. Only real findings; quote the code. Under 400 words."

### 3. Runtime pass — drive the running app

Static analysis infers exposure; this pass **observes** it. Start the app (use the project's run/verify skill if present, otherwise its dev command). Then:

- **Probe every API route.** Call each endpoint and inspect the response body for raw sensitive values. If a masking/redaction toggle exists, exercise it **enabled**: with redaction on, confirm no raw sensitive value appears in any response. Compare responses against the underlying stored data.
- **Load every page in a browser.** For each page check: (a) the **Network tab** responses for raw sensitive data; (b) the **DOM/HTML source** for sensitive data that is visually hidden but present in the markup; (c) the JS bundle / RSC payload / `__NEXT_DATA__` and any `NEXT_PUBLIC_*` values for leaked secrets or PII.
- Record each observed leak with the exact endpoint/page and the offending field.

If the app can't be started, say so explicitly in the report and fall back to static-only for the affected dimensions — never silently skip.

### 4. Aggregate

Collect static + runtime findings, dedupe (a leak confirmed at runtime supersedes the static inference of the same issue — merge them and keep the runtime evidence), and rank by severity. Do not drop a static finding just because the runtime pass didn't reach it; mark it static-only.

### 5. Report

Write the full report to `docs/security-report.md` and present a summary in chat. Structure:

- **Summary** — counts per severity, and the single worst issue.
- **Findings** — severity-ordered (Critical first). Each: title · severity · dimension · location · concrete failure (what data leaks, where, observed at runtime or inferred statically) · remediation.
- **Coverage** — which dimensions ran static-only vs static+runtime, and anything that couldn't be checked (e.g. the app wouldn't start) — so gaps are visible and the report is never implied-complete when it isn't.

Do **not** apply any fix. The report is the deliverable.
