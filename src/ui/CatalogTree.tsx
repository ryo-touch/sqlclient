import { Box, Text, useStdout } from "ink";

import type { ColumnRef, SchemaRef, TableRef } from "../types.ts";

export type CatalogNode =
  { kind: "schema"; value: SchemaRef } | { kind: "table"; value: TableRef };

interface CatalogTreeProps {
  nodes: readonly CatalogNode[];
  columns: readonly ColumnRef[];
  selectedIndex: number;
  activePane: "schemas" | "tables";
  selectedSchema?: string;
  selectedTable?: string;
}

function truncate(value: string, width: number): string {
  return value.length > width
    ? `${value.slice(0, Math.max(0, width - 1))}…`
    : value;
}

function visibleRange(length: number, selectedIndex: number, height: number) {
  const count = Math.max(1, height);
  const start = Math.max(
    0,
    Math.min(selectedIndex - Math.floor(count / 2), length - count),
  );
  return { start, end: Math.min(length, start + count) };
}

export function CatalogTree({
  nodes,
  columns,
  selectedIndex,
  activePane,
  selectedSchema,
  selectedTable,
}: CatalogTreeProps) {
  const { stdout } = useStdout();
  const terminalWidth = stdout.columns ?? 80;
  const narrow = terminalWidth < 100;
  const leftContentWidth = Math.max(16, Math.floor(terminalWidth * 0.6) - 8);
  const availableRows = Math.max(3, (stdout.rows ?? 24) - 8);
  const nodeRange = visibleRange(
    nodes.length,
    activePane === "schemas" ? selectedIndex : 0,
    availableRows,
  );
  const columnRange = visibleRange(
    columns.length,
    activePane === "tables" ? selectedIndex : 0,
    availableRows,
  );

  return (
    <Box>
      <Box
        width="60%"
        flexDirection="column"
        borderStyle="single"
        borderColor={activePane === "schemas" ? "cyan" : undefined}
        paddingX={1}
      >
        <Text bold>Catalog</Text>
        {nodes.length === 0 ? <Text dimColor>No catalog entries.</Text> : null}
        {nodeRange.start > 0 ? (
          <Text dimColor>… {nodeRange.start} above</Text>
        ) : null}
        {nodes.slice(nodeRange.start, nodeRange.end).map((node, localIndex) => {
          const index = nodeRange.start + localIndex;
          const selected = activePane === "schemas" && index === selectedIndex;
          if (node.kind === "schema") {
            const expanded = node.value.schema === selectedSchema;
            return (
              <Text
                key={`schema:${node.value.schema}`}
                inverse={selected}
                color={expanded ? "cyan" : undefined}
              >
                {selected ? ">" : " "} {expanded ? "▾" : "▸"}{" "}
                {truncate(node.value.schema, leftContentWidth - 4)}
              </Text>
            );
          }
          const rows =
            node.value.approxRows === undefined
              ? ""
              : ` ~${node.value.approxRows}`;
          return (
            <Text
              key={`table:${node.value.schema}:${node.value.table}`}
              inverse={selected}
              color={node.value.table === selectedTable ? "green" : undefined}
            >
              {selected ? ">" : " "} └{" "}
              {truncate(node.value.table, leftContentWidth - 5)}
              {narrow || rows === "" ? "" : <Text dimColor>{rows}</Text>}
            </Text>
          );
        })}
        {nodeRange.end < nodes.length ? (
          <Text dimColor>… {nodes.length - nodeRange.end} below</Text>
        ) : null}
      </Box>
      <Box
        width="40%"
        flexDirection="column"
        borderStyle="single"
        borderColor={activePane === "tables" ? "cyan" : undefined}
        paddingX={1}
      >
        <Text bold>Columns{selectedTable ? ` · ${selectedTable}` : ""}</Text>
        {columns.length === 0 ? <Text dimColor>Select a table.</Text> : null}
        {columnRange.start > 0 ? (
          <Text dimColor>… {columnRange.start} above</Text>
        ) : null}
        {columns
          .slice(columnRange.start, columnRange.end)
          .map((column, localIndex) => {
            const index = columnRange.start + localIndex;
            return (
              <Text
                key={column.name}
                inverse={activePane === "tables" && index === selectedIndex}
              >
                {activePane === "tables" && index === selectedIndex ? ">" : " "}{" "}
                {column.isPrimaryKey ? "◆" : " "}{" "}
                {truncate(column.name, narrow ? 24 : 20)}
                {narrow ? "" : `  ${column.dataType}`}
                {column.nullable ? "" : "  not null"}
              </Text>
            );
          })}
        {columnRange.end < columns.length ? (
          <Text dimColor>… {columns.length - columnRange.end} below</Text>
        ) : null}
      </Box>
    </Box>
  );
}
