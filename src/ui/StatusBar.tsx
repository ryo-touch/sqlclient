import { Text, useStdout } from "ink";

import type { Mode, QueryError } from "../types.ts";

interface StatusBarProps {
  mode: Mode;
  running: boolean;
  runningSeconds: number;
  message?: string;
  error?: QueryError;
}

function keys(mode: Mode): string {
  switch (mode) {
    case "connections":
      return "j/k move · Enter connect · / filter · ? help · q quit";
    case "catalog":
      return "j/k move · h/l pane · Enter open · s system · y copy · e edit · Tab result · ? help · q back";
    case "result":
      return "j/k rows · h/l columns · n/p page · y copy · e edit · r rerun · Tab query · ? help · q catalog";
    case "query":
      return "type SQL · Cmd+Enter run · Tab editor/result/history · Esc back";
    case "help":
      return "q/Esc close help";
  }
}

function compactKeys(mode: Mode): string {
  switch (mode) {
    case "connections":
      return "j/k move Enter connect / filter ? help q quit";
    case "catalog":
      return "j/k move h/l pane Enter open s sys y copy e SQL ? help q back";
    case "result":
      return "j/k rows h/l cols n/p page y copy e SQL r rerun Tab query q back";
    case "query":
      return "type SQL Cmd+Enter run Tab panes Esc back";
    case "help":
      return "q/Esc close help";
  }
}

export function StatusBar({
  mode,
  running,
  runningSeconds,
  message,
  error,
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
  return (
    <Text dimColor>
      {(stdout.columns ?? 80) < 100 ? compactKeys(mode) : keys(mode)}
    </Text>
  );
}
