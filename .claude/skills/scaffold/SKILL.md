---
name: scaffold
description: Entry point for a fresh copy of this template. Takes a non-developer's requirements, checks them for feasibility against the template, clarifies anything ambiguous, then drives /to-prd and /to-spec to produce the project's PRD and per-feature specs. Use when someone first sets up the template, or asks to scaffold / kick off / plan a new project from requirements.
disable-model-invocation: true
---

This is the first skill a user runs after downloading this template codebase. The user describes what they want to build — **assume they are a non-developer**. Your job is to turn their requirements into a feasible, fully-specified plan, then generate the project PRD and the per-feature specs.

Throughout, talk to the user in their own language and in plain, non-technical terms. Work through the four stages below in order.

## 1. Understand the template

Explore the codebase to learn what the template already provides — its stack, structure, and the capabilities it ships with. Feasibility is judged against this: what's easy here, what needs building, and what doesn't fit.

## 2. Feasibility review

Read the user's requirements and assess each one against the template:

- **Straightforward** — the template already supports this, or it's a small addition.
- **Significant** — buildable, but it's real work or new infrastructure.
- **Risky / out of scope** — doesn't fit the template, needs something it can't reasonably provide, or is very large.

Tell the user where each requirement lands, in plain language. Be honest about cost and risk — a non-developer can't see it otherwise.

## 3. Clarify ambiguities

Wherever a requirement is ambiguous or has more than one reasonable approach, ask the user — **one question at a time**, waiting for each answer before the next (asking many at once is bewildering).

For every question:

- Frame it for a non-developer: no jargon, concrete consequences.
- When there are multiple options, explain each option's **impact** (what it changes for them — cost, effort, what the product can or can't do) and its **importance** (how much this choice actually matters), so they can judge it.
- Give your **recommended** option and say why.
- If a question can be answered by exploring the codebase, do that instead of asking.

Keep going until the requirements are unambiguous and you and the user share the same picture of what's being built.

## 4. Produce the PRD and specs

Once the plan is clear and agreed:

1. Run /to-prd to write the project's PRD. The PRD names the full list of features to be built.
2. For **every** feature listed in the PRD, run /to-spec to write that feature's spec under `docs/specs/`.

Finally, report back the PRD location and the list of specs you created.
