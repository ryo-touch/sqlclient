import { Box, Text, useStdout } from "ink";

import type { ConnectionSummary } from "../types.ts";

interface HeaderProps {
  current?: ConnectionSummary;
  readOnlyVerified: boolean;
}

export function Header({ current, readOnlyVerified }: HeaderProps) {
  const { stdout } = useStdout();
  const narrow = (stdout.columns ?? 80) < 90;
  return (
    <Box
      justifyContent={narrow ? undefined : "space-between"}
      flexDirection={narrow ? "column" : "row"}
    >
      <Text bold>sqlclient</Text>
      {current ? (
        <Text dimColor={narrow}>
          {current.name} · {current.engine}{" "}
          {readOnlyVerified ? <Text color="green">[read-only]</Text> : null}
        </Text>
      ) : (
        <Text dimColor>not connected</Text>
      )}
    </Box>
  );
}
