# Leaf Template

Use this for focused subsystem guides: a feature area, local runtime, hook
family, worker, reconciliation path, or other leaf-level subsystem.

Follow [standard.md](./standard.md). This template only defines the leaf altitude:
specific enough to preserve local mechanisms, but not a full implementation
tour.

```md
# <Leaf Subsystem Name>

<Intro: value, owned model/vocabulary, inputs, outputs, and boundaries.>

## Design Notes

- **<Value plus mechanism>.** <Explain the local design choice, why it matters,
  and what future edits should preserve.>
- **<Value plus mechanism>.** <Explain async, update, caching, ownership, or
  boundary behavior when it is meaningful.>
- **<Value plus mechanism>.** <Name responsibilities this subsystem deliberately
  does not own when that prevents likely wrong changes.>

## Subsystem Map

- `<primary-entry-or-folder>` owns ...
- `<supporting-folder>` owns ...
- `<shared-contract-file>` owns ...

<!-- Optional, only when it removes ambiguity. -->
## Known Limitations

<Explain explicit omissions, why they are acceptable today, and the signal that
should trigger a different design.>
```

Leaf guides preserve local mechanisms: core model, async/update behavior,
caching, correctness boundaries, public or host-provided inputs, outputs that
cross subsystem boundaries, and likely wrong generalizations.
