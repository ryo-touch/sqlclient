import { Box, Text } from "ink";

import type { ConnectionSummary } from "../types.ts";

interface HeaderProps {
  current?: ConnectionSummary;
  readOnlyVerified: boolean;
}

export function Header({ current, readOnlyVerified }: HeaderProps) {
  return (
    <Box justifyContent="space-between">
      <Text bold>sqlclient</Text>
      {current ? (
        <Text>
          {current.name} · {current.engine}{" "}
          {readOnlyVerified ? <Text color="green">[read-only]</Text> : null}
        </Text>
      ) : (
        <Text dimColor>not connected</Text>
      )}
    </Box>
  );
}
