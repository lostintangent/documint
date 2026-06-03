// Floating toolbar shown when the caret sits on an empty top-level
// paragraph. Inserts block-level markdown — lists, headings, tables,
// blockquotes, code blocks, dividers — by writing the corresponding
// markdown prefix at the caret.

import {
  Code2,
  Heading,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Heading5,
  Heading6,
  List,
  ListOrdered,
  ListTodo,
  Minus,
  Table2,
  TextQuote,
  type LucideIcon,
} from "lucide-react";
import { insertCodeBlock, insertTable, insertText } from "@/editor";
import { useEditorCommand } from "../../store";
import { LeafToolbar } from "./core/toolbar/LeafToolbar";

// `text` is the markdown prefix inserted at the caret; `label` is the
// visible menu-item display.
const headingActions: { icon: LucideIcon; label: string; text: string }[] = [
  { icon: Heading1, label: "Heading 1", text: "# " },
  { icon: Heading2, label: "Heading 2", text: "## " },
  { icon: Heading3, label: "Heading 3", text: "### " },
  { icon: Heading4, label: "Heading 4", text: "#### " },
  { icon: Heading5, label: "Heading 5", text: "##### " },
  { icon: Heading6, label: "Heading 6", text: "###### " },
];

const tableColumnCounts = [2, 3, 4, 5] as const;

export function InsertionLeaf() {
  const insertCodeBlockCommand = useEditorCommand(insertCodeBlock);
  const insertTableCommand = useEditorCommand(insertTable);
  const insertTextCommand = useEditorCommand(insertText);

  return (
    <LeafToolbar>
      <LeafToolbar.Button
        icon={List}
        label="Insert bulleted list"
        onClick={() => insertTextCommand("- ")}
      />
      <LeafToolbar.Button
        icon={ListOrdered}
        label="Insert numbered list"
        onClick={() => insertTextCommand("1. ")}
      />
      <LeafToolbar.Button
        icon={ListTodo}
        label="Insert task list"
        onClick={() => insertTextCommand("- [ ] ")}
      />
      <LeafToolbar.Divider />
      <LeafToolbar.Menu icon={Heading} label="Insert heading" onSelect={insertTextCommand}>
        {headingActions.map(({ icon, label, text }) => (
          <LeafToolbar.MenuItem icon={icon} key={text} text={label} value={text} />
        ))}
      </LeafToolbar.Menu>
      <LeafToolbar.Menu
        icon={Table2}
        label="Insert table"
        onSelect={(value) => insertTableCommand(Number(value))}
      >
        {tableColumnCounts.map((columns) => (
          <LeafToolbar.MenuItem
            icon={Table2}
            key={columns}
            text={`${columns} columns`}
            value={String(columns)}
          />
        ))}
      </LeafToolbar.Menu>
      <LeafToolbar.Divider />
      <LeafToolbar.Button
        icon={TextQuote}
        label="Insert blockquote"
        onClick={() => insertTextCommand("> ")}
      />
      <LeafToolbar.Button icon={Code2} label="Insert code block" onClick={insertCodeBlockCommand} />
      <LeafToolbar.Button
        icon={Minus}
        label="Insert divider"
        onClick={() => insertTextCommand("--- ")}
      />
    </LeafToolbar>
  );
}
