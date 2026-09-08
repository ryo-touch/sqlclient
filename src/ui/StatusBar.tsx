import { Text, useStdout } from "ink";

import type { Mode, QueryError, QueryFocus } from "../types.ts";

interface StatusBarProps {
  mode: Mode;
  running: boolean;
  runningSeconds: number;
  message?: string;
  error?: QueryError;
  queryFocus?: QueryFocus;
}

function keys(mode: Mode): string {
  switch (mode) {
    case "connections":
      return "j/k move · Enter connect · / filter · ? help · q quit";
    case "catalog":
      return "j/k move · Enter schema→query/open table · h/l collapse/expand · s system · y copy · ? help · q back";
    case "result":
      return "j/k rows · h/l columns · n/p page · y copy · e edit · r rerun · Tab query · ? help · q catalog";
    case "query":
      return "type SQL · Cmd+Enter run · Ctrl-Space complete · Ctrl-G external editor · Tab panes · Esc back";
    case "help":
      return "q/Esc close help";
  }
}

function compactKeys(mode: Mode): string {
  switch (mode) {
    case "connections":
      return "j/k move Enter connect / filter ? help q quit";
    case "catalog":
      return "j/k move Enter query/open h/l tree s sys y copy ? help q back";
    case "result":
      return "j/k rows h/l cols n/p page y copy e SQL r rerun Tab query q back";
    case "query":
      return "type SQL Cmd+Enter run Ctrl-Space complete Ctrl-G editor Tab panes Esc back";
    case "help":
      return "q/Esc close help";
  }
}

function queryPaneKeys(focus: QueryFocus, compact: boolean): string {
  switch (focus) {
    case "editor":
      return compact
        ? "type SQL Cmd+Enter run Ctrl-Space complete Ctrl-G external Tab panes"
        : "type SQL · Cmd+Enter run · Ctrl-Space complete · Ctrl-G external editor · Tab panes · Esc back";
    case "result":
      return compact
        ? "j/k rows h/l cols y copy Tab/Shift+Tab panes e editor Esc back"
        : "j/k rows · h/l columns · y copy · Tab/Shift+Tab panes · e editor · Esc back";
    case "history":
      return compact
        ? "j/k move Enter load r run Tab/Shift+Tab panes Esc back"
        : "j/k move · Enter load · r run · Tab/Shift+Tab panes · Esc back";
  }
}

export function StatusBar({
  mode,
  running,
  runningSeconds,
  message,
  error,
  queryFocus,
}: StatusBarProps) {
  const { stdout } = useStdout();
  if (running) {
    return (
      <Text color="cyan">
        Running {runningSeconds.toFixed(1)}s · Ctrl-C cancel
      </Text>
    );
  }
  if (error) return <Text color="red">{error.message.split(/\r?\n/u)[0]}</Text>;
  if (message) return <Text color="green">{message}</Text>;
  const compact = (stdout.columns ?? 80) < 100;
  if (mode === "query" && queryFocus) {
    return (
      <Text dimColor>
        focus: {queryFocus} · {queryPaneKeys(queryFocus, compact)}
      </Text>
    );
  }
  return <Text dimColor>{compact ? compactKeys(mode) : keys(mode)}</Text>;
}
