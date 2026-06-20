---
name: plan
description: Use when planning a non-trivial codebase change by researching current behavior, drafting a precise implementation proposal, and iterating on that proposal with the review team in .agents/team.md before implementation.
---

# Planning Workflow

1. Research the provided topic, codebase subsystems, and relevant files until you have a deep understanding of the current behavior. Prefer local source, tests, exports, subsystem `AGENTS.md` files, and existing call sites over assumptions.

1. Write a precise proposal for surgically introducing the requested change on top of the current behavior. Include the intended ownership boundaries, affected files or subsystems, expected data/control flow, validation strategy, and the assumptions or key decisions you have made or still need to make.

1. Write the initial plan to a markdown file in the session state. Include at least:
   - Goal
   - Current Behavior
   - Proposed Design
   - Implementation Sequence
   - Assumptions And Decisions
   - Validation Plan
   - Open Questions Or Follow-Up Debt

   Quality bar:
   - Separate design components from execution order.
   - Use milestones for substantial work, with a clear minimum valuable milestone when scope may be cut.
   - For each implementation step, briefly state: what changes, why now, self-critique/risk, and validation.
   - Resolve ownership and source-of-truth decisions before designing abstractions around them.
   - Include anti-goals when overengineering or scope creep is a realistic risk.
   - Validate behavior, not just structure: name the outcome or invariant that proves the change is correct. For behavior-preserving refactors, name the specific observable that proves behavior was preserved, especially when the thing being refactored is the thing being measured.

   Self-checks before review (catch what reviewers otherwise flag):
   - Every step is executable when reached: its inputs come from earlier steps, and no step depends on an artifact introduced later.
   - Pinned decisions state their actual numbers, units, and defaults. "A canonical policy" is not actionable. The values are (run count, warmup count, percentile method, and similar).
   - When a step preserves existing behavior, decide whether that behavior is intended or merely current and unverified, and route the unverified kind to Open Questions instead of silently canonizing it.
   - Open Questions name the alternatives you considered and deferred, not only unknowns.

1. If canvases are available in the current environment, open the plan file in the Documint canvas so the user can read and respond to it. If canvases are unavailable, provide the plan file path and a concise summary.

1. Read `../../team.md`, choose the applicable reviewers, and spin up subagents for honest critique of the plan file. Run as many critique/revision rounds as needed until the plan has converged. The plan has converged when a round surfaces only cosmetic deltas or trivia, with no blockers and no new sequencing or source-of-truth questions. When that happens, stop: more planning is then worth less than executing the minimum valuable milestone, and continued plan-polishing is a procrastination smell. Ask reviewers for blockers, follow-up debt, what landed well, concrete suggestions, and whether the plan is too broad for the current codebase. Do not use subagents as a substitute for your own codebase reading. You're responsible for having judgement and taste for what suggestions are worth taking, and you're simply relying on the sub-agents as thought partners with specific focus areas.
