import { Box, Text, useStdout } from "ink";

import type { ResultSet } from "../types.ts";
import { formatValue, truncateCell } from "../util/format.ts";

interface ResultGridProps {
  result: ResultSet;
  selectedRow: number;
  selectedColumn: number;
  columnOffset: number;
}

interface VisibleColumn {
  index: number;
  width: number;
}

function widths(result: ResultSet): number[] {
  return result.columns.map((column, columnIndex) => {
    const sampleWidth = result.rows.reduce((maximum, row) => {
      const value = formatValue(row[columnIndex]).text.length;
      return Math.max(maximum, value);
    }, column.length);
    return Math.min(32, Math.max(4, sampleWidth));
  });
}

function visibleColumns(
  columnWidths: readonly number[],
  offset: number,
  availableWidth: number,
): VisibleColumn[] {
  const visible: VisibleColumn[] = [];
  let used = 0;
  for (let index = offset; index < columnWidths.length; index += 1) {
    const width = columnWidths[index] ?? 4;
    const required = width + (visible.length === 0 ? 0 : 3);
    if (visible.length > 0 && used + required > availableWidth) break;
    visible.push({
      index,
      width: Math.min(width, Math.max(4, availableWidth - used)),
    });
    used += required;
  }
  return visible;
}

function rowRange(length: number, selected: number, height: number) {
  const count = Math.max(1, height);
  const start = Math.max(
    0,
    Math.min(selected - Math.floor(count / 2), length - count),
  );
  return { start, end: Math.min(length, start + count) };
}

export function ResultGrid({
  result,
  selectedRow,
  selectedColumn,
  columnOffset,
}: ResultGridProps) {
  const { stdout } = useStdout();
  const terminalWidth = stdout.columns ?? 80;
  const terminalHeight = stdout.rows ?? 24;
  const columnWidths = widths(result);
  const columns = visibleColumns(
    columnWidths,
    columnOffset,
    Math.max(20, terminalWidth - 4),
  );
  const range = rowRange(result.rows.length, selectedRow, terminalHeight - 8);

  if (result.columns.length === 0) {
    return <Text dimColor>Query completed without row data.</Text>;
  }

  return (
    <Box flexDirection="column">
      <Text>
        {result.rowCount} row{result.rowCount === 1 ? "" : "s"} ·{" "}
        {result.elapsedMs.toFixed(1)} ms
        {result.truncated ? " · truncated to 2000" : ""}
      </Text>
      <Text bold>
        {columns.map((column, index) => (
          <Text key={column.index}>
            {index === 0 ? "" : " │ "}
            {truncateCell(result.columns[column.index] ?? "", column.width)}
          </Text>
        ))}
      </Text>
      {range.start > 0 ? (
        <Text dimColor>… {range.start} rows above</Text>
      ) : null}
      {result.rows.slice(range.start, range.end).map((row, localRow) => {
        const rowIndex = range.start + localRow;
        return (
          <Text key={rowIndex}>
            {columns.map((column, index) => {
              const formatted = formatValue(row[column.index]);
              return (
                <Text
                  key={column.index}
                  inverse={
                    rowIndex === selectedRow && column.index === selectedColumn
                  }
                  dimColor={formatted.isNull}
                >
                  {index === 0 ? "" : " │ "}
                  {truncateCell(formatted.text, column.width)}
                </Text>
              );
            })}
          </Text>
        );
      })}
      {range.end < result.rows.length ? (
        <Text dimColor>… {result.rows.length - range.end} rows below</Text>
      ) : null}
    </Box>
  );
}
