import { Box, Text, useStdout } from "ink";

import type { SchemaRef, TableRef } from "../types.ts";

export type CatalogNode =
  { kind: "schema"; value: SchemaRef } | { kind: "table"; value: TableRef };

interface CatalogTreeProps {
  nodes: readonly CatalogNode[];
  selectedIndex: number;
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
  selectedIndex,
  selectedSchema,
  selectedTable,
}: CatalogTreeProps) {
  const { stdout } = useStdout();
  const terminalWidth = stdout.columns ?? 80;
  const narrow = terminalWidth < 100;
  const contentWidth = Math.max(16, terminalWidth - 8);
  const availableRows = Math.max(3, (stdout.rows ?? 24) - 8);
  const nodeRange = visibleRange(nodes.length, selectedIndex, availableRows);

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor="cyan"
      paddingX={1}
    >
      <Text bold>Catalog</Text>
      {nodes.length === 0 ? <Text dimColor>No catalog entries.</Text> : null}
      {nodeRange.start > 0 ? (
        <Text dimColor>… {nodeRange.start} above</Text>
      ) : null}
      {nodes.slice(nodeRange.start, nodeRange.end).map((node, localIndex) => {
        const index = nodeRange.start + localIndex;
        const selected = index === selectedIndex;
        if (node.kind === "schema") {
          const expanded = node.value.schema === selectedSchema;
          return (
            <Text
              key={`schema:${node.value.schema}`}
              inverse={selected}
              color={expanded ? "cyan" : undefined}
            >
              {selected ? ">" : " "} {expanded ? "▾" : "▸"}{" "}
              {truncate(node.value.schema, contentWidth - 4)}
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
            {truncate(node.value.table, contentWidth - 5)}
            {narrow || rows === "" ? "" : <Text dimColor>{rows}</Text>}
          </Text>
        );
      })}
      {nodeRange.end < nodes.length ? (
        <Text dimColor>… {nodes.length - nodeRange.end} below</Text>
      ) : null}
    </Box>
  );
}
