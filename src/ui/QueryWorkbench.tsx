import type { ComponentProps, ReactNode } from "react";
import { Box, Text, useStdout } from "ink";

import { highlightSql, type SqlSegmentName } from "../core/highlight.ts";
import {
  cursorPresentation,
  queryWorkbenchLayout,
  selectionWindow,
} from "../core/query-editor.ts";
import type { Engine, HistoryEntry, QueryFocus, ResultSet } from "../types.ts";
import { formatDateTime } from "../util/format.ts";
import { ResultGrid } from "./ResultGrid.tsx";

interface QueryWorkbenchProps {
  engine: Engine;
  sql: string;
  cursor: number;
  focus: QueryFocus;
  result?: ResultSet;
  history: readonly HistoryEntry[];
  selectedIndex: number;
  selectedColumn: number;
  columnOffset: number;
}

function colorFor(name: SqlSegmentName): ComponentProps<typeof Text>["color"] {
  switch (name) {
    case "keyword":
      return "cyan";
    case "function":
      return "blue";
    case "number":
      return "yellow";
    case "string":
      return "green";
    case "comment":
      return "gray";
    case "special":
    case "bracket":
      return "magenta";
    case "identifier":
    case "whitespace":
      return undefined;
  }
}

function highlightedEditor(
  sql: string,
  cursor: number,
  engine: Engine,
  active: boolean,
): ReactNode[] {
  const nodes: ReactNode[] = [];
  let offset = 0;
  for (const [index, segment] of highlightSql(sql, engine).entries()) {
    const relativeCursor = cursor - offset;
    const color = colorFor(segment.name);
    if (
      active &&
      relativeCursor >= 0 &&
      relativeCursor < segment.content.length
    ) {
      const cursorCharacter = segment.content[relativeCursor];
      const cursor = cursorPresentation(cursorCharacter);
      nodes.push(
        <Text color={color} key={`${index}:before`}>
          {segment.content.slice(0, relativeCursor)}
        </Text>,
        <Text color="black" backgroundColor="cyan" key={`${index}:cursor`}>
          {cursor.glyph}
        </Text>,
        <Text color={color} key={`${index}:after`}>
          {cursor.trailingNewline}
          {segment.content.slice(relativeCursor + 1)}
        </Text>,
      );
    } else {
      nodes.push(
        <Text color={color} key={index}>
          {segment.content}
        </Text>,
      );
    }
    offset += segment.content.length;
  }
  if (active && cursor === sql.length) {
    nodes.push(
      <Text color="black" backgroundColor="cyan" key="cursor:end">
        {" "}
      </Text>,
    );
  }
  return nodes;
}

function visibleEditor(sql: string, cursor: number, lineLimit: number) {
  const lines = sql.split("\n");
  const cursorLine = sql.slice(0, cursor).split("\n").length - 1;
  const startLine = Math.max(
    0,
    Math.min(cursorLine - Math.floor(lineLimit / 2), lines.length - lineLimit),
  );
  const visibleLines = lines.slice(startLine, startLine + lineLimit);
  const removedLength = lines
    .slice(0, startLine)
    .reduce((length, line) => length + line.length + 1, 0);
  return {
    sql: visibleLines.join("\n"),
    cursor: cursor - removedLength,
    above: startLine,
    below: Math.max(0, lines.length - startLine - visibleLines.length),
  };
}

function preview(sql: string, width: number): string {
  const firstLine = sql.split(/\r?\n/u)[0] ?? "";
  return firstLine.length > width
    ? `${firstLine.slice(0, Math.max(0, width - 1))}…`
    : firstLine;
}

export function QueryWorkbench({
  engine,
  sql,
  cursor,
  focus,
  result,
  history,
  selectedIndex,
  selectedColumn,
  columnOffset,
}: QueryWorkbenchProps) {
  const { stdout } = useStdout();
  const terminalWidth = stdout.columns ?? 100;
  const terminalRows = stdout.rows ?? 24;
  const layout = queryWorkbenchLayout(terminalRows, history.length > 0);
  const editor = visibleEditor(sql, cursor, layout.editorLines);
  const historyRange = selectionWindow(
    history.length,
    focus === "history" ? selectedIndex : 0,
    layout.historyLimit,
  );
  const visibleHistory = history.slice(historyRange.start, historyRange.end);
  const resultWidth = Math.max(30, Math.floor(terminalWidth * 0.58) - 4);
  const historyPreviewWidth = Math.max(
    8,
    Math.floor(terminalWidth * 0.42) - 19,
  );

  return (
    <Box>
      <Box width="42%" flexDirection="column" paddingRight={1}>
        <Box
          borderStyle={focus === "editor" ? "double" : "single"}
          borderColor={focus === "editor" ? "cyan" : undefined}
          paddingX={1}
          flexDirection="column"
          minHeight={layout.editorLines + 2}
        >
          <Text bold color={focus === "editor" ? "cyan" : undefined}>
            {focus === "editor" ? "▶ " : "  "}SQL · Cmd+Enter run · Ctrl-Space
            complete
          </Text>
          {editor.above > 0 ? (
            <Text dimColor>… {editor.above} lines above</Text>
          ) : null}
          <Text>
            {highlightedEditor(
              editor.sql,
              editor.cursor,
              engine,
              focus === "editor",
            )}
          </Text>
          {editor.below > 0 ? (
            <Text dimColor>… {editor.below} lines below</Text>
          ) : null}
        </Box>
        {layout.showHistory ? (
          <Box
            borderStyle={focus === "history" ? "double" : "single"}
            borderColor={focus === "history" ? "cyan" : undefined}
            paddingX={1}
            flexDirection="column"
          >
            <Text bold color={focus === "history" ? "cyan" : undefined}>
              {focus === "history" ? "▶ " : "  "}History
            </Text>
            {historyRange.start > 0 ? (
              <Text dimColor>… {historyRange.start} entries above</Text>
            ) : null}
            {visibleHistory.map((entry, localIndex) => {
              const index = historyRange.start + localIndex;
              return (
                <Text
                  key={`${entry.executedAt.getTime()}:${index}`}
                  inverse={focus === "history" && index === selectedIndex}
                >
                  {focus === "history" && index === selectedIndex ? ">" : " "}{" "}
                  {entry.ok ? "✓" : "✗"}{" "}
                  {formatDateTime(entry.executedAt).slice(11)}{" "}
                  {preview(entry.sql, historyPreviewWidth)}
                </Text>
              );
            })}
            {historyRange.end < history.length ? (
              <Text dimColor>
                … {history.length - historyRange.end} entries below
              </Text>
            ) : null}
          </Box>
        ) : null}
      </Box>
      <Box
        width="58%"
        borderStyle={focus === "result" ? "double" : "single"}
        borderColor={focus === "result" ? "cyan" : undefined}
        paddingX={1}
        flexDirection="column"
      >
        <Text bold color={focus === "result" ? "cyan" : undefined}>
          {focus === "result" ? "▶ " : "  "}Result
        </Text>
        {result ? (
          <ResultGrid
            result={result}
            selectedRow={focus === "result" ? selectedIndex : -1}
            selectedColumn={selectedColumn}
            columnOffset={columnOffset}
            availableWidth={resultWidth}
          />
        ) : (
          <Text dimColor>Run SQL with Cmd+Enter.</Text>
        )}
      </Box>
    </Box>
  );
}
