import { Box, Text } from "ink";

import type { ConnectionListItem, ConnectionSummary } from "../types.ts";

interface ConnectionListProps {
  connections: readonly ConnectionListItem[];
  selectedIndex: number;
  activeConnection?: ConnectionSummary;
}

function cell(value: string, width: number): string {
  return value.length > width
    ? `${value.slice(0, Math.max(0, width - 1))}…`
    : value.padEnd(width);
}

export function ConnectionList({
  connections,
  selectedIndex,
  activeConnection,
}: ConnectionListProps) {
  if (connections.length === 0) {
    return <Text dimColor>No configured connections were found.</Text>;
  }

  return (
    <Box flexDirection="column">
      <Text bold>
        {cell("Connection", 28)} {cell("Engine", 10)} {cell("Source", 12)}{" "}
        Status
      </Text>
      {connections.map((connection, index) => {
        const selected = index === selectedIndex;
        const active =
          connection.name === activeConnection?.name &&
          connection.engine === activeConnection.engine &&
          connection.source === activeConnection.source;
        const status = active
          ? "active"
          : connection.available
            ? "available"
            : (connection.unavailableReason ?? "unavailable");
        return (
          <Text
            key={`${connection.engine}:${connection.source}:${connection.name}`}
            inverse={selected}
            dimColor={!connection.available}
          >
            {selected ? ">" : " "} {cell(connection.name, 26)}{" "}
            {cell(connection.engine, 10)} {cell(connection.source, 12)} {status}
          </Text>
        );
      })}
    </Box>
  );
}
