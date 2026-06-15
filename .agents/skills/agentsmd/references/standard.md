# Standard

Subsystem `AGENTS.md` files are orientation guides for strong engineers who are
new to a part of the codebase. They should make the reader smarter faster by
naming the right concepts in the right order. They are not exhaustive file
trees, implementation tours, or test plans.

## Core Shape

Every guide has three core sections:

- **Intro:** the subsystem's what, why, central vocabulary, and role in the app.
- **Design Notes:** the important conceptual "how" behind the intro.
- **Subsystem Map:** where the logic lives and where to start reading.

Optional `Known Limitations` sections are allowed only when current gaps or
obvious omissions would otherwise look accidental. Explain what the subsystem
intentionally does not do, why that is acceptable today, and what signal should
trigger a different design. Do not turn this into a backlog.

## Intro

Use one or two paragraphs. Lead with user or host-application value, not the
implementation.

Answer:

- What capability and value does this subsystem provide?
- What domain model, key concept, or vocabulary does it own?
- What does it consume, produce, preserve, expose, and deliberately leave
  elsewhere?

If the subsystem has a central concept, name and define it using concrete
subsystem language. Do not hide it behind generic phrases such as "reactivity
needs," "integration layer," or "coordination logic." Give the reader the noun
they should use while reading the code.

## Design Notes

Start directly with the notes. Do not add a generic framing paragraph.

Each note should be a present-tense truth with this shape:

```md
- **<Value plus mechanism>.** Explain how the mechanism works and why it matters.
```

The bold lead-ins should stand alone as the scannable design story. A reader who
skims only those labels should understand the subsystem's main shape.

Favor insights over facts. Include only meaningful properties such as modeling
decisions, async boundaries, ownership rules, integration contracts,
responsibilities the subsystem intentionally does not own, performance
tradeoffs, or work moved off hot paths.

Order notes by progressive disclosure: start with the central semantic idea,
then explain outward along the reader's likely causal model: supporting
concepts, architectural decisions or tradeoffs, and subsystem boundaries. A
useful sequence is often:

1. The core model or contract.
2. Expensive or risky work and where it happens.
3. Incremental/update behavior.
4. Caching or hot-path behavior.
5. Async/staleness/correctness behavior.
6. Extensibility or boundary constraints.

Use real subsystem nouns and verbs instead of generic labels. Do not bury the
lede behind implementation terms or tradeoff language.

Keep the list concise. Five bullets is a good default; six is usually the upper
bound before the section starts to feel like a concept inventory. Add more only
when each note is distinct, important, and worth preserving.

## Subsystem Map

The map answers "where does the logic live?"

Keep it top-level. Map folders and top-level files only, unless a specific
entry file is the subsystem's primary surface. Order entries semantically for
progressive disclosure, not alphabetically: start where a contributor should
start reading, then move outward through supporting modules, configuration,
shared contracts, and secondary folders.

For each entry, state ownership in one concise sentence:

```md
- `foo/` owns ...
- `bar.ts` owns ...
```

Do not hide design principles in the map. If an ownership rule matters for
design quality, mention it in Design Notes and use the map only to point to the
code that implements it.

## Review Bar

A strong guide lets a new contributor quickly explain:

- why the subsystem matters
- what vocabulary to use while reading the code
- what design properties are worth preserving
- what responsibilities belong somewhere else
- where to start reading or editing

A strong guide should make misplaced work easier to spot. Before calling it
done, ask: what tempting change would someone incorrectly put in this subsystem,
and does the guide make clear why that responsibility is outside this subsystem?

Remove anything that merely catalogs files, repeats obvious facts, or makes the
reader ask "who cares?"
