---
name: implement
description: "Implement the work for one or more specs. A single spec is built directly; when several specs or a PRD are tied together in the session, each spec is built sequentially in its own general-purpose sub-agent. Runs /review once over all the work at the end."
disable-model-invocation: true
---

Implement the work described by the spec(s) the user is pointing at.

## 1. Determine the scope

Work out which specs this run covers:

- **Single spec** — the user pointed at one spec and the session isn't tying several together.
- **Multiple specs** — the session involves a PRD (`docs/PRD.md`) or several specs under `docs/specs/` that belong to this work. The scope is **every** such spec, not just the first.

## 2. Implement

**Single spec:** implement it directly, running typechecking regularly as you go.

**Multiple specs — sequentially, one sub-agent each:**

- Order the specs by the PRD's build order / priorities if it defines one; otherwise put dependencies before the specs that rely on them.
- For each spec in order, spawn a **general-purpose sub-agent** to implement that one spec. **Wait for each to finish before starting the next** — the specs share one codebase and later ones often build on earlier ones, so parallel agents would collide.
- Tell each sub-agent to implement its spec only, typecheck as it goes, and **not** to run /review.
- If a sub-agent can't finish its spec, stop and report instead of pressing on — later specs may depend on it.

## 3. Review once, at the end

Only after **all** in-scope work is implemented, run a final typecheck, then use /review a single time to review the whole body of work together.
