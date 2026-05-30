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
} from "lucide-react";
import { insertCodeBlock, insertTable, insertText } from "@/editor";
import { useEditorCommand } from "../../store";
import { LeafToolbar } from "./toolbar/LeafToolbar";

type HeadingAction = {
  icon: typeof Heading1;
  label: string;
  text: string;
};

const headingActions: HeadingAction[] = [
  { icon: Heading1, label: "Heading 1", text: "# " },
  { icon: Heading2, label: "Heading 2", text: "## " },
  { icon: Heading3, label: "Heading 3", text: "### " },
  { icon: Heading4, label: "Heading 4", text: "#### " },
  { icon: Heading5, label: "Heading 5", text: "##### " },
  { icon: Heading6, label: "Heading 6", text: "###### " },
];

const tableActions = [
  { columns: 2, text: "2 columns" },
  { columns: 3, text: "3 columns" },
  { columns: 4, text: "4 columns" },
  { columns: 5, text: "5 columns" },
];

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
        {tableActions.map(({ columns, text }) => (
          <LeafToolbar.MenuItem icon={Table2} key={columns} text={text} value={String(columns)} />
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
