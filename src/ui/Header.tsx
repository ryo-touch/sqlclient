import { Box, Text, useStdout } from "ink";

import type { ConnectionSummary } from "../types.ts";

interface HeaderProps {
  current?: ConnectionSummary;
  schema?: string;
  table?: string;
  readOnlyVerified: boolean;
}

export function Header({
  current,
  schema,
  table,
  readOnlyVerified,
}: HeaderProps) {
  const { stdout } = useStdout();
  const narrow = (stdout.columns ?? 80) < 90;
  return (
    <Box flexDirection={narrow ? "column" : "row"}>
      <Text bold color="cyan">
        sqlclient
      </Text>
      {narrow ? null : <Text> </Text>}
      {current ? (
        <Text dimColor={narrow}>
          <Text color="cyan">[{current.engine}]</Text> {current.name}
          {schema ? (
            <Text>
              {" "}
              <Text dimColor>›</Text> {schema}
            </Text>
          ) : null}
          {table ? (
            <Text>
              {" "}
              <Text dimColor>›</Text> <Text bold>{table}</Text>
            </Text>
          ) : null}
          {readOnlyVerified ? <Text color="green"> ✓ read-only</Text> : null}
        </Text>
      ) : (
        <Text dimColor>not connected</Text>
      )}
    </Box>
  );
}
