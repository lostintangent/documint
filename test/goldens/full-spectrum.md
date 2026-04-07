# Editable Preview

The semantic runtime model captures *structure*, **marks**, and [links](https://example.com).

- Bullet item
- Nested bullet
  - Child item

1. Ordered item
1. Ordered continuation

- [x] Task complete
- [ ] Task pending

> Blockquotes stay semantic.

| Layer    | Purpose                       |
| :------- | :---------------------------- |
| Domain   | runtime invariants            |
| Markdown | parse / normalize / serialize |

```ts
export function activeRegion() {
  return "local";
}
```

:::callout{tone="note"}
Directives remain available for future extensions.
:::

![Preview shell](https://example.com/preview.png "Preview shell")
