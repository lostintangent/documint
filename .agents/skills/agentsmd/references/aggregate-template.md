# Aggregate Template

Use this for parent subsystem guides: directories that coordinate multiple child
subsystems or sit at a major architectural layer.

Follow [standard.md](./standard.md). This template only defines the aggregate
altitude: explain cross-cutting role, orchestration, ownership, and routing. Do
not duplicate leaf subsystem details.

```md
# <Aggregate Subsystem Name>

<Intro: aggregate role, value, centralized responsibilities, delegated
responsibilities, and neighboring-layer boundaries.>

## Design Notes

- **<Cross-cutting value plus mechanism>.** <Explain a rule or design choice
  that applies across child subsystems and would not belong in any one leaf
  guide.>
- **<Boundary plus ownership>.** <Explain what belongs in this aggregate and
  what belongs in neighboring layers or child subsystem guides.>
- **<Coordination model plus reason>.** <Explain how child subsystems interact
  without repeating their leaf-level implementation details.>

## Subsystem Map

- `<main-entry-file>` owns ...
- [`child-a/`](child-a/AGENTS.md) owns ...
- [`child-b/`](child-b/AGENTS.md) owns ...
- `<shared-folder>` owns ...
```

Link to child `AGENTS.md` files when they exist. The map should route readers to
child guides and top-level entrypoints, not restate the lower-level design
details those guides own.

If a diagram helps, prefer a small text diagram that will not go stale or break
as an external asset. Remove diagrams that merely duplicate the map.
