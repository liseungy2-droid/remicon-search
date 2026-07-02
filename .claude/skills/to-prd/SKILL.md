---
name: to-prd
description: Synthesize the agreed requirements into a single project-level PRD and save it to docs/PRD.md — no interview, just synthesis. The PRD names the full list of features, each of which later becomes its own spec via /to-spec.
---

This skill takes the current conversation — the requirements and decisions already agreed with the user — and produces one project-level PRD. Do NOT interview the user; that has already happened (e.g. in /scaffold). Just synthesize what's been decided.

The PRD sits one level above the feature specs: it frames the whole project and, crucially, names the **full list of features** that will each get their own spec via /to-spec.

## Process

1. Explore the repo to understand the template's current state, if you haven't already. If the project documents a domain glossary or any ADRs, use that vocabulary and respect those decisions.

2. Write the PRD using the template below and save it to `docs/PRD.md` (create `docs/` if it doesn't exist).

<prd-template>

## Problem Statement

The problem the user is trying to solve, from their perspective.

## Solution

The product you're going to build, from the user's perspective — what it does and who it's for.

## Features

A numbered list of every feature the project will include. For each feature give:

- **<kebab-case-name>** — a one-or-two sentence description of what it does, from the user's perspective.

This list is the contract for the rest of the workflow: /to-spec is run once per feature here, writing `docs/specs/<kebab-case-name>.md`. Make the list complete, and make each feature a coherent unit that can be specced on its own.

## Scope & Priorities

Which features are core vs. nice-to-have, and any sensible build order.

## Out of Scope

Things explicitly not being built, and why — especially anything ruled out during the feasibility review.

## Further Notes

Constraints, decisions, or context that affect the project as a whole (not a single feature).

</prd-template>
