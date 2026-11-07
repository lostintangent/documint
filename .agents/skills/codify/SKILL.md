---
name: codify
description: Use when writing, revising, or reviewing a subsystem AGENTS.md guide, so it captures ownership, design intent, invariants, and routing in the project's standard shape.
---

# Codify Subsystem Knowledge

A subsystem `AGENTS.md` is a shortcut to the essential insight about a subsystem: what role it plays and why it exists, so a reader doesn't have to reconstruct that from the code. It gives a rich TL;DR of the subsystem, then a short list of the qualities that make it earn its existence. Write for a capable person who has never seen this code, in language about what users and host apps get rather than how the code does it. A guide doesn't repeat the code, state the obvious, list every file, or track a backlog.

## Workflow

1. Edit a guide only when there is knowledge worth keeping: ownership, design intent, invariants, public contracts, routing, known limitations, or a likely misconception. For a review, report findings and edit only when asked.
1. Ground it. Read the parent and local `AGENTS.md`, the public exports, and representative call sites or tests. For a new guide or a rewrite, read every source file of a leaf subsystem, or every child guide, public entrypoint, and a representative path through each child of an aggregate one. When that is too much to read, say what you skipped and how the paths you read cover each contract. A review of prose alone needs source only to check a claim.
1. Before drafting, name the central thesis, the vocabulary, the value to users or hosts, the boundaries, and the wrong change the guide should prevent.
1. Draft to the standard below, then review in three passes: against the source for contradictions, through the bold lead-ins alone as the design story, and for repetition, adjacent facts, and insider language to cut. For high-impact guides, add the lenses of a new contributor, the domain model, the runtime flow, and a ruthless editor, through reviewers when available or your own passes otherwise.
1. Take feedback only when it fixes a contradiction, clarifies ownership or routing, prevents a likely wrong change, or removes noise. Reject feedback that makes the guide more complete but less useful.

## Shape

```md
# <Subsystem Name>

<Intro paragraph>

## Design Notes

- **<Concept plus the value it creates>.** <How the mechanism delivers that value, and why the shape matters.>

## Subsystem Map

- `<first file or folder to read>` owns ...
- [`child/`](child/AGENTS.md) owns ...
```

An aggregate guide such as `src/component` links each child guide from its map and explains how the children work together, not how each works inside. A leaf guide such as `src/component/sync` explains its own mechanisms.

Add `## Known Limitations` only when a gap would otherwise look accidental. Say what the subsystem doesn't do, why that is acceptable today, and what signal should trigger a different design.

Never use semicolons or em dashes. Split the sentence, or use a comma, colon, or parentheses.

## Intro

Write one paragraph that works as the TL;DR. Its first sentence says what a user, host app, or neighboring subsystem gets from this code and names the central noun or vocabulary that makes the subsystem legible. Stop before the mechanism, which belongs in Design Notes. Prefer a few representative examples over exhaustive lists. Use the subsystem's concrete nouns instead of phrases like "integration layer" or "coordination logic", and gloss any term owned by another guide on first use. `src/markdown/AGENTS.md` is the reference example.

## Design Notes

Each note is a present-tense truth about one quality that makes the subsystem earn its existence. Its bold lead-in names the concept and the value it delivers, in terms a user or host would notice when possible, so the lead-ins alone read as the design story, ordered from the first concept a contributor needs through hot paths, correctness, and boundaries.

- Prefer `Frames keep painters focused on 2D drawing` over the abstraction-first `Frames decouple editor meaning from renderer output`.
- Prefer `Editable regions give selection, layout, and paint one text surface` over the structure-first `Region records own local text offsets` or the problem-first `Selection needs one text surface`.
- Skip inflated nouns such as "contract" or "abstraction" when a plainer value phrase says the same thing.
- `src/component/decorations/AGENTS.md` is the reference example, with lead-ins like `Worker classification keeps typing non-blocking` and `Changed roots drive incremental invalidation`.

Notes deepen the intro instead of restating it. Every sentence serves its lead-in by explaining ownership, an invariant, a tradeoff, a risk, a boundary, or work kept off a hot path. When a concept exists because two shapes or constraints don't line up, name that mismatch. Aim for about three notes in a focused subsystem, and add more only for genuinely distinct architecture. Merge notes that tell the same story, and delete any note whose removal wouldn't make the guide less useful. Start the list directly, without a framing paragraph.

## Subsystem Map

The map says where the logic lives. List top-level files and folders, and deeper files only when they are a public contract, a choke point, or the safest first read. Order entries by where to start reading, not alphabetically, and give each one sentence of ownership. Design meaning belongs in Design Notes, not the map.

## Done when

A new contributor can say why the subsystem matters, which vocabulary to read the code with, which design properties to preserve, which responsibilities belong elsewhere, and where to start. Test the guide against one tempting change that belongs in another subsystem, and make sure it shows why. For runtime-heavy subsystems, check that it names the cadence owner, the invalidation or commit boundary, the stale-result and failure policy, and the hot path it protects, when those are central.
