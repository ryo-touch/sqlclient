import { Text, useStdout } from "ink";

import { renderStatusHints, statusHints } from "../core/status-hints.ts";
import type { Mode, QueryError, QueryFocus } from "../types.ts";

interface StatusBarProps {
  mode: Mode;
  queryFocus: QueryFocus;
  running: boolean;
  runningSeconds: number;
  message?: string;
  error?: QueryError;
}

// App renders the status bar inside a Box with paddingX={1}.
const HORIZONTAL_PADDING = 2;

export function StatusBar({
  mode,
  queryFocus,
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
  const prefix = mode === "query" ? `focus: ${queryFocus} · ` : "";
  const columns = Math.max(
    1,
    (stdout.columns ?? 80) - HORIZONTAL_PADDING - prefix.length,
  );
  return (
    <Text dimColor>
      {prefix}
      {renderStatusHints(statusHints(mode, queryFocus), columns)}
    </Text>
  );
}
