import { Columns2, Plus, Rows3, Table2, Trash2 } from "lucide-react";
import { LeafToolbar } from "./toolbar/LeafToolbar";

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

const deleteColumnAction = { text: "Delete column", value: "delete" } as const;
const deleteRowAction = { text: "Delete row", value: "delete" } as const;
const deleteTableAction = { text: "Delete table", value: "delete" } as const;

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
          if (value === deleteColumnAction.value) {
            onDeleteColumn();
            return;
          }

          onInsertColumn(value as "left" | "right");
        }}
      >
        {columnInsertActions.map(({ text, value }) => (
          <LeafToolbar.MenuItem icon={Plus} key={value} text={text} value={value} />
        ))}
        <LeafToolbar.MenuDivider />
        <LeafToolbar.MenuItem
          disabled={!canDeleteColumn}
          icon={Trash2}
          text={deleteColumnAction.text}
          value={deleteColumnAction.value}
        />
      </LeafToolbar.Menu>
      <LeafToolbar.Menu
        icon={Rows3}
        label="Row actions"
        onSelect={(value) => {
          if (value === deleteRowAction.value) {
            onDeleteRow();
            return;
          }

          onInsertRow(value as "above" | "below");
        }}
      >
        {rowInsertActions.map(({ text, value }) => (
          <LeafToolbar.MenuItem icon={Plus} key={value} text={text} value={value} />
        ))}
        <LeafToolbar.MenuDivider />
        <LeafToolbar.MenuItem
          disabled={!canDeleteRow}
          icon={Trash2}
          text={deleteRowAction.text}
          value={deleteRowAction.value}
        />
      </LeafToolbar.Menu>
      <LeafToolbar.Divider />
      <LeafToolbar.Menu
        icon={Table2}
        label="Table actions"
        onSelect={() => onDeleteTable()}
      >
        <LeafToolbar.MenuItem
          icon={Trash2}
          text={deleteTableAction.text}
          value={deleteTableAction.value}
        />
      </LeafToolbar.Menu>
    </LeafToolbar>
  );
}
