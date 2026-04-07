/**
 * SSR-only semantic HTML surface for the editor before the interactive canvas
 * host mounts on the client.
 */
import type { ReactNode } from "react";
import type { Block, Inline, Link, Mark } from "@/document";

type DocumintSsrProps = {
  blocks: Block[];
};

export function DocumintSsr({ blocks }: DocumintSsrProps) {
  return <>{blocks.map((block) => renderSsrBlock(block))}</>;
}

function renderSsrBlock(block: Block): ReactNode {
  switch (block.type) {
    case "blockquote":
      return (
        <blockquote className="preview-block preview-block-blockquote" key={block.id}>
          <DocumintSsr blocks={block.children} />
        </blockquote>
      );
    case "code":
      return (
        <div className="preview-block preview-block-code" key={block.id}>
          <div className="preview-rich-header">{formatCodeBlockSummary(block.language, block.meta)}</div>
          <pre>
            <code>{block.value || "\u00A0"}</code>
          </pre>
        </div>
      );
    case "heading": {
      const HeadingTag = `h${block.depth}` as const;

      return (
        <HeadingTag className="preview-block preview-block-heading" key={block.id}>
          {renderSsrInlineNodes(block.children)}
        </HeadingTag>
      );
    }
    case "list":
      return block.ordered ? (
        <ol className="preview-block preview-block-list" key={block.id} start={block.start ?? 1}>
          {block.children.map((child) => renderSsrListItem(child))}
        </ol>
      ) : (
        <ul className="preview-block preview-block-list" key={block.id}>
          {block.children.map((child) => renderSsrListItem(child))}
        </ul>
      );
    case "listItem":
      return renderSsrListItem(block);
    case "paragraph":
      return (
        <p className="preview-block preview-block-paragraph" key={block.id}>
          {renderSsrInlineNodes(block.children)}
        </p>
      );
    case "table":
      return (
        <div className="preview-block preview-block-table" key={block.id}>
          <div className="preview-rich-header">
            {formatTableSummary(
              block.rows.length,
              block.rows[0]?.cells.length ?? 0,
              block.align.filter((entry) => entry !== null).length,
            )}
          </div>
          <div className="preview-table-scroll">
            <table>
              <tbody>
                {block.rows.map((row) => (
                  <tr key={row.id}>
                    {row.cells.map((cell) => (
                      <td key={cell.id}>{renderSsrInlineNodes(cell.children)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      );
    case "thematicBreak":
      return <hr className="preview-block preview-block-rule" key={block.id} />;
    case "unsupported":
      return (
        <pre className="preview-block preview-block-unsupported" key={block.id}>
          {block.raw}
        </pre>
      );
  }
}

function renderSsrListItem(block: Extract<Block, { type: "listItem" }>) {
  return (
    <li className="preview-block preview-block-list-item" key={block.id}>
      <DocumintSsr blocks={block.children} />
    </li>
  );
}

function renderSsrInlineNodes(nodes: Inline[]): ReactNode {
  return nodes.map((node) => {
    switch (node.type) {
      case "break":
        return <br key={node.id} />;
      case "image":
        return (
          <span className="preview-inline preview-inline-image" key={node.id}>
            <img alt={node.alt ?? ""} src={node.url} title={node.title ?? ""} />
            <span>
              <strong>{formatImageLabel(node.alt)}</strong>
              <small>{formatImageSummary(node.url, node.title)}</small>
            </span>
          </span>
        );
      case "inlineCode":
        return (
          <code className="preview-inline preview-inline-code" key={node.id}>
            {node.code}
          </code>
        );
      case "link":
        return renderSsrLink(node);
      case "text":
        return (
          <span className="preview-inline" key={node.id}>
            {renderMarkedText(node.text, node.marks)}
          </span>
        );
      case "unsupported":
        return (
          <span className="preview-inline preview-inline-unsupported" key={node.id}>
            {node.raw}
          </span>
        );
    }
  });
}

function renderSsrLink(node: Link) {
  return (
    <a className="preview-inline preview-inline-link" href={node.url} key={node.id}>
      {renderSsrInlineNodes(node.children)}
    </a>
  );
}

function renderMarkedText(text: string, marks: Mark[]) {
  let content: ReactNode = text;

  for (const mark of marks) {
    switch (mark) {
      case "strikethrough":
        content = <del>{content}</del>;
        break;
      case "italic":
        content = <em>{content}</em>;
        break;
      case "bold":
        content = <strong>{content}</strong>;
        break;
      case "underline":
        content = <ins>{content}</ins>;
        break;
    }
  }

  return content;
}

function formatCodeBlockSummary(language: string | null, meta: string | null) {
  return [language ?? "plain text", meta].filter(Boolean).join(" \u2022 ");
}

function formatTableSummary(rowCount: number, columnCount: number, alignedCount: number) {
  const alignment =
    alignedCount > 0 ? `${alignedCount} aligned ${alignedCount === 1 ? "column" : "columns"}` : "no alignment";

  return `${rowCount} ${rowCount === 1 ? "row" : "rows"} \u2022 ${columnCount} ${columnCount === 1 ? "column" : "columns"} \u2022 ${alignment}`;
}

function formatImageLabel(alt: string | null) {
  return alt?.trim() ? alt : "Untitled image";
}

function formatImageSummary(url: string, title: string | null) {
  return title?.trim() ? `${title} \u2022 ${url}` : url;
}
