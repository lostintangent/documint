---
name: codify
description: Workflow guidance for codifying, reviewing, and iterating on AGENTS.md subsystem guides as codebase knowledge evolves, including subsystem purpose, design notes, known limitations, ownership boundaries, and routing maps.
metadata:
  short-description: Codify subsystem knowledge
---

# Codify Subsystem Knowledge

1. Choose the workflow path based on the user's request, any associated code or documentation change, and any design knowledge that should become durable:

   - For incidental edits to an existing guide, proceed only when there is knowledge worth codifying: ownership, design intent, invariants, public contracts, subsystem routing, known limitations, likely contributor misconceptions, or standard/template convergence. User-requested guide edits can proceed when they satisfy the request and the standard.
   - For new guides or substantial rewrites, use the exhaustive grounding rules below and codify what future contributors need to know but cannot easily infer from source alone.
   - For review-only tasks, check whether the existing guide still codifies the subsystem accurately and clearly. Do not draft or edit unless the user asks for changes.

1. Ground the guide before writing or reviewing:

   - Always read the nearest parent `AGENTS.md` and the existing local `AGENTS.md` when present.
   - For source-grounded edits, new guides, substantial rewrites, or source-truth review, also read public exports such as `index.ts` and representative tests or call sites when they clarify behavior. Use `rg` to find representative imports and usage paths.
   - For review-only tasks that are strictly about standard compliance or prose quality, ground against the relevant guide and standard first. Read source files only when checking source truth, ownership claims, or missing subsystem behavior.
   - For new or substantially rewritten leaf guides, read every source file in the subsystem.
   - For new or substantially rewritten aggregate guides, read every child guide, top-level entrypoint, public contract, and representative path for each child subsystem.
   - For subsystems too large to read exhaustively, read primary entrypoints and representative implementation paths instead.

   If the subsystem is too large to read exhaustively, say so explicitly and state what was not read, why, and how the chosen paths cover each public contract or child subsystem.

1. Read [standard.md](references/standard.md). Treat it as the durable writing standard.

1. Synthesize the subsystem knowledge before drafting:
   - Central thesis
   - Owned domain concepts or vocabulary
   - User and/or host-application value
   - Inputs, outputs, and boundaries
   - Design properties and known limitations worth preserving
   - Potentially wrong changes the guide should help prevent

1. Decide the guide type:
   - **Aggregate guide:** covers a parent subsystem with child subsystems.
   - **Leaf guide:** covers a focused subsystem or feature area.
   - Example: `src/component/AGENTS.md` is aggregate, while `src/component/sync/AGENTS.md` is leaf.

1. Use the matching reference:

   - [aggregate-template.md](references/aggregate-template.md) for parent subsystem guides.
   - [leaf-template.md](references/leaf-template.md) for focused subsystem guides.

   Templates define shape and altitude only. If guidance applies to both templates, put it in the standard instead of repeating it.

1. Review and iterate until the guide codifies the subsystem clearly and satisfies the standard:

   - For source-grounded changes, make at least one contradiction pass against the source.
   - Make one bloat-removal pass against the standard: value first, concrete vocabulary, design notes as a learning path, map as routing, and no file-tree filler.
   - Make one plain-language pass against the standard.
   - Make one design-truth pass against the standard.
   - For dense notes, rewrite from the ownership idea first, then add back only the source facts needed to prevent the wrong change.
   - Before finalizing a new or substantially changed guide, challenge each design note by naming the wrong change, burden, or risk it prevents. Revise or delete notes that fail.
   - After adding, removing, or splitting design notes, reread only the bold lead-ins and fix duplication or order drift against the standard.
   - For high-impact guides, use five targeted reviewer perspectives when available: new contributor, domain model, runtime flow, ruthless editor, and standard compliance. Reviewer agents are optional/tooling-dependent. When they are unavailable, perform those passes manually.

   Take only feedback that fixes a real contradiction, clarifies ownership or routing, prevents a likely wrong change, improves repeatability of the guide-writing process, or removes noise. Reject feedback that is merely stylistic, speculative, or would make the guide more complete but less useful.
