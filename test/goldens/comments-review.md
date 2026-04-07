# Review Surface

The review surface keeps comment anchors durable across edits and markdown reloads.

- List feedback should stay attached during structural edits.
- Secondary bullet remains unannotated.

| Area         | Note                                         |
| ------------ | -------------------------------------------- |
| Review queue | Table cell anchors should stay attached too. |

:::documint-comments
```json
{
  "threads": [
    {
      "quote": "review surface",
      "anchor": {
        "prefix": "The ",
        "suffix": " keeps comment anchors d"
      },
      "comments": [
        {
          "body": "Focus the durable anchor claim.",
          "updatedAt": "2026-04-05T12:00:00.000Z"
        }
      ]
    },
    {
      "quote": "List feedback",
      "anchor": {
        "suffix": " should stay attached du"
      },
      "comments": [
        {
          "body": "Verify list-item comments survive structural edits.",
          "updatedAt": "2026-04-05T12:02:00.000Z"
        }
      ]
    },
    {
      "quote": "Table cell anchors",
      "anchor": {
        "kind": "tableCell",
        "suffix": " should stay attached to"
      },
      "comments": [
        {
          "body": "Confirm table-cell comments remain sticky too.",
          "updatedAt": "2026-04-05T12:04:00.000Z"
        }
      ]
    }
  ]
}
```
:::
