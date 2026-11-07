import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { LeafMarkdown } from "@/component/overlays/leaves/core/LeafMarkdown";

describe("LeafMarkdown", () => {
  test("renders text and inline formatting from markdown", () => {
    const html = renderToStaticMarkup(
      <LeafMarkdown value={"Plain **bold** and *italic* with `code`."} />,
    );

    expect(html).toContain("<p>Plain <strong>bold</strong> and <em>italic</em> with ");
    expect(html).toContain(">code</code>");
  });

  test("renders semantic mentions and links from parsed inlines", () => {
    const html = renderToStaticMarkup(
      <LeafMarkdown value={"Ping @[Jane Doe](u-jane) via [docs](https://example.com)."} />,
    );

    expect(html).toContain(">@Jane Doe</span>");
    expect(html).toContain(
      '<a href="https://example.com" rel="noreferrer" target="_blank">docs</a>',
    );
  });

  test("renders bare mentions when mention targets are provided", () => {
    const html = renderToStaticMarkup(
      <LeafMarkdown
        mentionTargets={[{ name: "Jane Doe", userId: "u-jane" }]}
        value={"Ping @Jane Doe."}
      />,
    );

    expect(html).toContain(">@Jane Doe</span>");
  });

  test("renders parsed link urls directly", () => {
    const html = renderToStaticMarkup(<LeafMarkdown value={"[custom](documint://thread/1)"} />);

    expect(html).toContain(
      '<a href="documint://thread/1" rel="noreferrer" target="_blank">custom</a>',
    );
  });

  test("renders list blocks", () => {
    const html = renderToStaticMarkup(
      <LeafMarkdown value={"- **One**\n- [x] Two\n\n3. Three\n4. Four"} />,
    );

    expect(html).toContain("<ul><li><p><strong>One</strong></p></li>");
    expect(html).toMatch(
      /<li[^>]*><input [^>]*type="checkbox" checked=""\/><p>Two<\/p><\/li><\/ul>/,
    );
    expect(html).toContain('<ol start="3"><li><p>Three</p></li><li><p>Four</p></li></ol>');
  });

  test.each([
    ["# Heading", ">Heading</p>"],
    ["> Quote\n>\n> > Nested", "<p>Nested</p></blockquote></blockquote>"],
    ["```ts\nconst a = 1;\n```", ">const a = 1;</pre>"],
    ["| A | Bee |\n| - | - |\n| one | 2 |", ">| A   | Bee |\n| --- | --- |\n| one | 2   |</pre>"],
    ["See ![alt](a.png)", "<p>See ![alt](a.png)</p>"],
  ])("shows %j instead of dropping it", (value, html) => {
    expect(renderToStaticMarkup(<LeafMarkdown value={value} />)).toContain(html);
  });
});
