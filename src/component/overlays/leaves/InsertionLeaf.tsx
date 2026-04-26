import {
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
  Table2,
  TextQuote,
} from "lucide-react";
import { LeafToolbar } from "./toolbar/LeafToolbar";

type InsertionLeafProps = {
  onInsert: (text: string) => void;
  onInsertTable: (columnCount: number) => void;
};

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

export function InsertionLeaf({ onInsert, onInsertTable }: InsertionLeafProps) {
  return (
    <LeafToolbar>
      <LeafToolbar.Button icon={List} label="Insert bulleted list" onClick={() => onInsert("- ")} />
      <LeafToolbar.Button
        icon={ListOrdered}
        label="Insert numbered list"
        onClick={() => onInsert("1. ")}
      />
      <LeafToolbar.Button
        icon={ListTodo}
        label="Insert task list"
        onClick={() => onInsert("- [ ] ")}
      />
      <LeafToolbar.Divider />
      <LeafToolbar.Menu icon={Heading} label="Insert heading" onSelect={onInsert}>
        {headingActions.map(({ icon, label, text }) => (
          <LeafToolbar.MenuItem icon={icon} key={text} text={label} value={text} />
        ))}
      </LeafToolbar.Menu>
      <LeafToolbar.Menu
        icon={Table2}
        label="Insert table"
        onSelect={(value) => onInsertTable(Number(value))}
      >
        {tableActions.map(({ columns, text }) => (
          <LeafToolbar.MenuItem icon={Table2} key={columns} text={text} value={String(columns)} />
        ))}
      </LeafToolbar.Menu>
      <LeafToolbar.Divider />
      <LeafToolbar.Button
        icon={TextQuote}
        label="Insert blockquote"
        onClick={() => onInsert("> ")}
      />
    </LeafToolbar>
  );
}
