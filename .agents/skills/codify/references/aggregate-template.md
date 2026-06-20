# Aggregate Template

```md
# <Aggregate Subsystem Name>

<Intro: aggregate value first, then the central role/vocabulary that makes the child subsystem relationships legible.>

## Design Notes

- **<First central aggregate contract>.** <Explain the aggregate-level value, orchestration, or boundary.>
- **<Next learning-path concept>.** <Explain how child subsystems interact without restating their leaf-level implementation details.>
- **<Another distinct concept if needed>.** <Keep only notes that earn their place at aggregate altitude.>

## Subsystem Map

- `<main-entry-file>` owns ...
- [`child-a/`](child-a/AGENTS.md) owns ...
- [`child-b/`](child-b/AGENTS.md) owns ...
- `<shared-folder>` owns ...
```

Add `Known Limitations` only when the standard says an expected omission would otherwise look accidental.
