import type { ComponentProps } from "react";
import { Box, Text, useStdout } from "ink";

import { highlightSql, type SqlSegmentName } from "../core/highlight.ts";
import type { Engine, HistoryEntry } from "../types.ts";

interface QueryPaneProps {
  engine: Engine;
  sql: string;
  history: readonly HistoryEntry[];
  selectedIndex: number;
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

function preview(sql: string): string {
  const firstLine = sql.split(/\r?\n/u)[0] ?? "";
  return firstLine.length > 68 ? `${firstLine.slice(0, 67)}…` : firstLine;
}

export function QueryPane({
  engine,
  sql,
  history,
  selectedIndex,
}: QueryPaneProps) {
  const { stdout } = useStdout();
  const terminalRows = stdout.rows ?? 24;
  const queryLineLimit = Math.max(3, Math.floor(terminalRows / 3));
  const queryLines = sql.split(/\r?\n/u);
  const displayedSql = queryLines.slice(0, queryLineLimit).join("\n");
  const historyLimit = Math.max(3, terminalRows - queryLineLimit - 8);
  const historyStart = Math.max(
    0,
    Math.min(
      selectedIndex - Math.floor(historyLimit / 2),
      history.length - historyLimit,
    ),
  );
  const visibleHistory = history.slice(
    historyStart,
    historyStart + historyLimit,
  );

  return (
    <Box flexDirection="column">
      <Box borderStyle="single" paddingX={1} flexDirection="column">
        <Text bold>Last query</Text>
        <Text>
          {sql === "" ? (
            <Text dimColor>No query has been run.</Text>
          ) : (
            highlightSql(displayedSql, engine).map((segment, index) => (
              <Text
                color={colorFor(segment.name)}
                key={`${index}:${segment.name}`}
              >
                {segment.content}
              </Text>
            ))
          )}
        </Text>
        {queryLines.length > queryLineLimit ? (
          <Text dimColor>… query continues</Text>
        ) : null}
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text bold>History</Text>
        {history.length === 0 ? <Text dimColor>No query history.</Text> : null}
        {historyStart > 0 ? <Text dimColor>… {historyStart} newer</Text> : null}
        {visibleHistory.map((entry, localIndex) => {
          const index = historyStart + localIndex;
          return (
            <Text
              key={`${entry.executedAt.getTime()}:${index}`}
              inverse={index === selectedIndex}
            >
              {index === selectedIndex ? ">" : " "} {entry.ok ? "✓" : "✗"}{" "}
              {preview(entry.sql)}
            </Text>
          );
        })}
        {historyStart + visibleHistory.length < history.length ? (
          <Text dimColor>
            … {history.length - historyStart - visibleHistory.length} older
          </Text>
        ) : null}
      </Box>
    </Box>
  );
}
