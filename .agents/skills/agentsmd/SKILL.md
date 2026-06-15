---
name: agentsmd
description: Author, revise, or review AGENTS.md subsystem guides for hierarchical codebases, including deciding whether a guide is aggregate or leaf-level and applying a concise orientation/design-notes/subsystem-map standard.
metadata:
  short-description: Write subsystem AGENTS.md guides
---

# AGENTS.md Subsystem Guides

Use this skill when creating, revising, or reviewing an `AGENTS.md` file for a
code subsystem.

## Workflow

1. Ground the guide before writing. Read, when present:
   - the nearest parent `AGENTS.md`
   - the existing local `AGENTS.md`
   - child or neighboring subsystem guides
   - public exports such as `index.ts`
   - primary entrypoints and one representative implementation path
   - representative tests or call sites when they clarify behavior
2. Decide the guide type:
   - **Aggregate guide:** covers a parent subsystem with child subsystems.
   - **Leaf guide:** covers a focused subsystem or feature area.
   - Example: `src/component/AGENTS.md` is aggregate; `src/component/sync/AGENTS.md`
     is leaf.
3. Read [standard.md](references/standard.md).
4. Use the matching reference:
   - [aggregate-template.md](references/aggregate-template.md) for parent
     subsystem guides.
   - [leaf-template.md](references/leaf-template.md) for focused subsystem
     guides.
5. Review the result against the standard: value first, concrete vocabulary,
   design notes as a learning path, map as routing, and no file-tree filler.

## Duplication Rule

Keep the durable writing standard in `standard.md`. Keep aggregate/leaf
templates focused on shape and altitude only. If guidance applies to both
templates, put it in the standard instead of repeating it.
