import { Box, Text, useStdout } from "ink";

import type { ConnectionSummary } from "../types.ts";

interface HeaderProps {
  current?: ConnectionSummary;
  schema?: string;
  readOnlyVerified: boolean;
}

export function Header({ current, schema, readOnlyVerified }: HeaderProps) {
  const { stdout } = useStdout();
  const narrow = (stdout.columns ?? 80) < 90;
  return (
    <Box flexDirection={narrow ? "column" : "row"}>
      <Text bold>sqlclient</Text>
      {narrow ? null : <Text> · </Text>}
      {current ? (
        <Text dimColor={narrow}>
          {current.name} · {current.engine} {schema ? `· ${schema} ` : ""}
          {readOnlyVerified ? <Text color="green">[read-only]</Text> : null}
        </Text>
      ) : (
        <Text dimColor>not connected</Text>
      )}
    </Box>
  );
}
