import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { LinkLeaf } from "@/component/overlays/leaves/LinkLeaf";

const noop = () => {};

describe("LinkLeaf", () => {
  test("hides edit actions when content editing is unavailable", () => {
    const html = renderToStaticMarkup(
      <LinkLeaf
        canEdit={false}
        onDelete={noop}
        onSave={noop}
        title="Docs"
        url="https://example.com"
      />,
    );

    expect(html).toContain("https://example.com");
    expect(html).not.toContain("Edit link");
    expect(html).not.toContain("Remove link");
  });
});
