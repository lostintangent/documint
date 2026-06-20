---
name: review
description: Use when reviewing implemented code changes after the fact, especially to assess correctness, architecture, subsystem ownership, performance, naming, test quality, and remaining design debt with help from the review team in .agents/team.md.
---

# Review Workflow

1. Inspect the working tree, changed files, and relevant diffs to understand the implementation. Read the owning subsystem `AGENTS.md` files, nearby source, public exports, tests, and representative call sites needed to judge the change in context.

1. Build a concise mental model of the intended behavior and the actual implementation. Identify the affected subsystems, data/control flow, public APIs, hot paths, tests, and any assumptions the implementation appears to make.

1. Read `../../team.md`, choose the applicable reviewers, and spin up subagents for independent critique. Ask them to focus on blockers, follow-up debt, what landed well, and concrete suggestions. Use additional rounds when feedback reveals unresolved design questions.

1. Run or recommend validation appropriate to the risk: focused tests, typecheck, lint, benchmark suites, playground/browser checks, or golden tests. Do not treat validation as a substitute for code review.

1. Report findings first, ordered by severity and grounded in file/function references. Separate blockers from follow-up debt, call out test or benchmark gaps, and summarize what landed well only after the issues. Do not edit files unless the user explicitly asks you to address the findings.
