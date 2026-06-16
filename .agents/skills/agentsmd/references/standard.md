# Standard

Subsystem `AGENTS.md` files are orientation guides for strong engineers who are new to a part of the codebase. They should make the reader smarter faster by naming the right concepts in the right order and telling a concrete, memorable narrative about the subsystem's what, why, how, and where. They are not exhaustive file trees, implementation tours, or test plans.

## Core Shape

Every guide has three core sections:

- **Intro:** the subsystem's what, why, central vocabulary, and role in the app.
- **Design Notes:** the important conceptual "how" behind the intro.
- **Subsystem Map:** where the logic lives and where to start reading.

Optional `Known Limitations` sections are allowed only when current gaps or obvious omissions would otherwise look accidental. Explain what the subsystem intentionally does not do, why that is acceptable today, and what signal should trigger a different design. Do not turn this into a backlog.

Use natural punctuation throughout. Do not use semicolons or em dashes. Split the thought into shorter sentences, or use a comma, colon, or parentheses when that reads naturally.

## Intro

Use one concise paragraph with natural, easy-to-parse sentences. Lead with what a user, host app, or neighboring subsystem gets from this code, then name the central noun, model, or vocabulary that makes the subsystem legible. Give enough shape to create curiosity, but stop before explaining the mechanism in detail. If the subsystem mostly serves embedders or internal contributors, still describe that value in plain product terms before introducing abstractions.

Make the central idea land as fast as possible. A reader should know the subsystem's main job and vocabulary from the first sentence, not after a tour of examples or implementation details.

Use `src/markdown/AGENTS.md` as the reference example: it leads with markdown-native user and host value, then names the Documint dialect and bespoke parser/serializer boundary without explaining parser mechanics.

Use representative examples instead of exhaustive lists unless completeness is the point. A short list plus "etc." is better than burying the central concept under everything the subsystem can render, parse, emit, or observe.

When orientation explains how the subsystem works, leave it for Design Notes. The intro establishes the concrete what and why. Design Notes drill into the load-bearing architectural properties that make that value true.

Use concrete subsystem language. Do not hide the central concept behind generic phrases such as "reactivity needs," "integration layer," or "coordination logic." Give the reader the noun they should use while reading the code.

## Design Notes

Start directly with the notes. Do not add a generic framing paragraph.

Each note should be a present-tense truth with this shape:

```md
- **<Value plus mechanism>.** Explain how the mechanism works and why it matters.
```

Lead with the value or reason a contributor should care, then name the mechanism. Make the idea land quickly. Avoid abstraction-first labels like "decoupling" unless the value is already obvious.

For example, prefer `Frames keep painters focused on 2D drawing` over `Frames decouple editor meaning from renderer output`.

The bold lead-ins should stand alone as the scannable design story, ordered from the central model or contract through the mechanisms, hot paths, correctness concerns, and boundaries a contributor needs next.

Include facts only when they explain ownership, invariants, tradeoffs, risks, integration contracts, boundaries, or work moved off hot paths. Make the ownership value explicit: what burden, risk, or misplaced work does the note prevent?

Each note should be a load-bearing concept in the reader's mental model of how the subsystem works and what role it plays in the application. If removing a note would not make the guide less useful, remove it. If two notes tell the same ownership story, merge them or delete the weaker one.

Order notes by progressive disclosure. Start with the first important question a reader should ask after the intro, do not spend a note restating the intro, and put dependency choices, implementation materials, and other FYI-style context later unless they are the subsystem's central design contract. Use real subsystem nouns and verbs instead of generic labels. Do not bury the lede behind implementation terms or tradeoff language.

Keep the list concise, but do not merge distinct load-bearing concepts just to keep the count down. Compact subsystems often land around three to five notes. Larger cohesive leaves or aggregate guides may need six or seven when the learning path genuinely demands it and every note is distinct, important, and worth preserving. Never add notes to hit a quota.

## Subsystem Map

The map answers "where does the logic live?"

Keep it top-level. Map folders and top-level files only, unless a non-top-level file is the public contract, architectural choke point, or safest first read. Order entries semantically for progressive disclosure, not alphabetically: start where a contributor should start reading, then move outward through supporting modules, configuration, shared contracts, and secondary folders.

For each entry, state ownership in one concise sentence:

```md
- `foo/` owns ...
- `bar.ts` owns ...
```

Do not hide design meaning in the map. If an ownership rule matters for design quality, mention it in Design Notes and use the map only to point to the code that implements it.

## Authoring Bar

A strong guide lets a new contributor quickly explain:

- why the subsystem matters
- what vocabulary to use while reading the code
- what design properties are worth preserving
- what responsibilities belong somewhere else
- where to start reading or editing

A strong guide should make misplaced work easier to spot. Before calling it done, ask: what tempting change would someone incorrectly put in this subsystem, and does the guide make clear why that responsibility is outside this subsystem?

For runtime-heavy subsystems, also ask whether the guide names the cadence owner, invalidation or commit boundary, async stale-result policy, failure or timeout behavior, and the hot path that protects user-visible responsiveness when those ideas are central to the design.

Remove anything that merely catalogs files, repeats obvious facts, or makes the reader ask "who cares?"

Do not include exhaustive file inventories, README restatements, implementation walkthroughs, TODO backlogs, or test-command sections unless the local subsystem has an exceptional reason for one.
