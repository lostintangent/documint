// Floating toolbar shown when the caret sits inside a table cell.
// Surfaces column/row insertion menus (left/right, above/below) and a
// destructive "delete table" trigger. Menu action dispatch goes by
// string value because `LeafToolbar.Menu`'s `onSelect` is string-typed.

import { Columns2, Plus, Rows3, Table2, Trash2 } from "lucide-react";
import { LeafToolbar } from "./core/toolbar/LeafToolbar";

type TableLeafProps = {
  canDeleteColumn: boolean;
  canDeleteRow: boolean;
  onDeleteColumn: () => void;
  onDeleteRow: () => void;
  onDeleteTable: () => void;
  onInsertColumn: (direction: "left" | "right") => void;
  onInsertRow: (direction: "above" | "below") => void;
};

const columnInsertActions = [
  { text: "Column left", value: "left" },
  { text: "Column right", value: "right" },
] as const;

const rowInsertActions = [
  { text: "Row above", value: "above" },
  { text: "Row below", value: "below" },
] as const;

export function TableLeaf({
  canDeleteColumn,
  canDeleteRow,
  onDeleteColumn,
  onDeleteRow,
  onDeleteTable,
  onInsertColumn,
  onInsertRow,
}: TableLeafProps) {
  return (
    <LeafToolbar>
      <LeafToolbar.Menu
        icon={Columns2}
        label="Column actions"
        onSelect={(value) => {
          if (value === "delete") {
            onDeleteColumn();
          } else if (value === "left" || value === "right") {
            onInsertColumn(value);
          }
        }}
      >
        {columnInsertActions.map(({ text, value }) => (
          <LeafToolbar.MenuItem icon={Plus} key={value} text={text} value={value} />
        ))}
        <LeafToolbar.MenuDivider />
        <LeafToolbar.MenuItem
          disabled={!canDeleteColumn}
          icon={Trash2}
          text="Delete column"
          value="delete"
        />
      </LeafToolbar.Menu>
      <LeafToolbar.Menu
        icon={Rows3}
        label="Row actions"
        onSelect={(value) => {
          if (value === "delete") {
            onDeleteRow();
          } else if (value === "above" || value === "below") {
            onInsertRow(value);
          }
        }}
      >
        {rowInsertActions.map(({ text, value }) => (
          <LeafToolbar.MenuItem icon={Plus} key={value} text={text} value={value} />
        ))}
        <LeafToolbar.MenuDivider />
        <LeafToolbar.MenuItem
          disabled={!canDeleteRow}
          icon={Trash2}
          text="Delete row"
          value="delete"
        />
      </LeafToolbar.Menu>
      <LeafToolbar.Divider />
      <LeafToolbar.Menu icon={Table2} label="Table actions" onSelect={onDeleteTable}>
        <LeafToolbar.MenuItem icon={Trash2} text="Delete table" value="delete" />
      </LeafToolbar.Menu>
    </LeafToolbar>
  );
}
