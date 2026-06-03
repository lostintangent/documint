import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MarkdownOutput } from "@/component/overlays/leaves/core/MarkdownOutput";

describe("MarkdownOutput", () => {
  test("renders text and inline formatting from markdown", () => {
    const html = renderToStaticMarkup(
      <MarkdownOutput value={"Plain **bold** and *italic* with `code`."} />,
    );

    expect(html).toContain("<p>Plain <strong>bold</strong> and <em>italic</em> with ");
    expect(html).toContain("bg-inline-code-bg");
    expect(html).toContain(">code</code>");
  });

  test("renders semantic mentions and links from parsed inlines", () => {
    const html = renderToStaticMarkup(
      <MarkdownOutput value={"Ping @[Jane Doe](u-jane) via [docs](https://example.com)."} />,
    );

    expect(html).toContain("whitespace-nowrap");
    expect(html).toContain(">@Jane Doe</span>");
    expect(html).toContain(
      '<a href="https://example.com" rel="noreferrer" target="_blank">docs</a>',
    );
  });

  test("renders bare mentions when mention targets are provided", () => {
    const html = renderToStaticMarkup(
      <MarkdownOutput
        mentionTargets={[{ name: "Jane Doe", userId: "u-jane" }]}
        value={"Ping @Jane Doe."}
      />,
    );

    expect(html).toContain("whitespace-nowrap");
    expect(html).toContain(">@Jane Doe</span>");
  });

  test("renders parsed link urls directly", () => {
    const html = renderToStaticMarkup(<MarkdownOutput value={"[custom](documint://thread/1)"} />);

    expect(html).toContain(
      '<a href="documint://thread/1" rel="noreferrer" target="_blank">custom</a>',
    );
  });

  test("renders list blocks", () => {
    const html = renderToStaticMarkup(
      <MarkdownOutput value={"- **One**\n- [x] Two\n\n3. Three\n4. Four"} />,
    );

    expect(html).toContain("<ul><li><p><strong>One</strong></p></li>");
    expect(html).toContain('<li class="grid grid-cols-[1rem_minmax(0,1fr)]');
    expect(html).toContain('<input class="m-0 mt-0.5"');
    expect(html).toContain("<p>Two</p></li></ul>");
    expect(html).toContain("<ol><li><p>Three</p></li><li><p>Four</p></li></ol>");
  });

  test("omits unsupported blocks", () => {
    const html = renderToStaticMarkup(
      <MarkdownOutput value={"# Heading\n\nFirst\n\n<div>raw</div>\n\n---"} />,
    );

    expect(html).toContain("<p>First</p>");
    expect(html).not.toContain("Heading");
    expect(html).not.toContain("&lt;div&gt;raw&lt;/div&gt;");
  });
});
