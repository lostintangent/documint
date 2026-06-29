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

Use concrete subsystem language. Do not hide the central concept behind generic phrases such as "reactivity needs," "integration layer," or "coordination logic." Avoid insider shorthand unless it is the subsystem's actual vocabulary and the intro defines it in plain language.

When a guide uses vocabulary owned by another guide, gloss it in a clause on first use. Add a link to the owning guide when helpful, but do not make readers leave the page just to decode a load-bearing noun.

## Design Notes

Start directly with the notes. Do not add a generic framing paragraph.

Each note should be a present-tense truth with this shape:

```md
- **<Concept plus problem or consumer value>.** Explain how the mechanism delivers that value and why the shape matters.
```

Lead with the load-bearing design, architecture, or domain concept, and make the problem it solves or value it creates visible in the same lead-in. Use concrete subsystem nouns and simple active phrasing. A strong lead-in should sound like a useful sentence a contributor could repeat in review.

Avoid three weak openings. Abstraction-first labels such as "decoupling" hide the value. Structure-first descriptions such as "X is a coordinate overlay" or "Region records own local offsets" state what the code is before why it exists. Problem-first descriptions such as "Selection needs one text surface" state a need without naming the concept that answers it. Avoid inflated nouns such as "contract" or "abstraction" when a plainer value phrase says the same thing.

For example, prefer `Frames keep painters focused on 2D drawing` over `Frames decouple editor meaning from renderer output`, and prefer `Editable regions give selection, layout, and paint one text surface` over either `Selection needs one text surface` or `Region records own local text offsets`. The stronger lead names the concept and the job it does. The weaker ones only describe the need or the mechanism.

Use `src/component/decorations/AGENTS.md` as the reference example for Design Notes. Its lead-ins name the concept and value together: `Worker classification keeps typing non-blocking`, `Changed roots drive incremental invalidation`, and `Region-relative caches make scroll cheap`.

The intro frames the subsystem's overall concept. Design Notes should deepen into sub-concepts, invariants, and mechanisms under that concept instead of repeating the intro's thesis as the first note. Deepening a concept named by the intro is not repetition: keep a note when it is the only place that explains how the concept works, why it matters, or what wrong change it prevents. The bold lead-ins should stand alone as the scannable design story, ordered from the first sub-concept a contributor needs through hot paths, correctness concerns, and boundaries.

Each note should carry one load-bearing concept in the reader's mental model of how the subsystem works and why that shape matters. Include facts only when they explain ownership, invariants, tradeoffs, risks, integration contracts, boundaries, or work moved off hot paths. When a concept exists because two shapes, layers, or constraints do not naturally line up, name that mismatch directly so the concept feels necessary. Every sentence in a note should earn its place against the bold lead-in. If a detail names nearby machinery but does not explain the concept and value in the lead-in, move it to another note, move it to the map, or delete it.

Keep the list concise, but do not merge distinct load-bearing concepts just to keep the count down. If removing a note would not make the guide less useful, remove it. If two notes tell the same ownership story, merge them or delete the weaker one. Aim for three tight notes for a focused subsystem. Add more only when the subsystem has genuinely distinct architecture worth preserving. Never add notes to hit a quota.

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

Remove anything that merely catalogs files, repeats obvious facts, gives procedural advice, uses unexplained insider language, or makes the reader ask "who cares?"

Do not include exhaustive file inventories, README restatements, implementation walkthroughs, TODO backlogs, or test-command sections unless the local subsystem has an exceptional reason for one.
