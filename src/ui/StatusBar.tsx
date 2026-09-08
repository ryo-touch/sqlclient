import { Text, useStdout } from "ink";

import { statusHintLine, statusRunningLine } from "../core/status-hints.ts";
import type { Mode, QueryError, QueryFocus } from "../types.ts";

interface StatusBarProps {
  mode: Mode;
  queryFocus: QueryFocus;
  running: boolean;
  runningSeconds: number;
  message?: string;
  error?: QueryError;
}

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
        {statusRunningLine(runningSeconds, message, stdout.columns ?? 80)}
      </Text>
    );
  }
  if (error) return <Text color="red">{error.message.split(/\r?\n/u)[0]}</Text>;
  if (message) return <Text color="green">{message}</Text>;
  return (
    <Text dimColor>
      {statusHintLine(mode, queryFocus, stdout.columns ?? 80)}
    </Text>
  );
}
