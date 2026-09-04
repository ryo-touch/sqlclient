import { Text } from "ink";

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
      return "j/k history · Enter/r run · e edit · Tab catalog · ? help · q result";
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
  if (running) {
    return (
      <Text color="cyan">
        Running {runningSeconds.toFixed(1)}s · Ctrl-C cancel
      </Text>
    );
  }
  if (error) return <Text color="red">{error.message.split(/\r?\n/u)[0]}</Text>;
  if (message) return <Text color="green">{message}</Text>;
  return <Text dimColor>{keys(mode)}</Text>;
}
