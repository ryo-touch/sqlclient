import { Box, Text } from "ink";

const bindings = [
  ["j / k, arrows", "move up and down"],
  ["h / l", "collapse/expand catalog or move result column"],
  ["g / G", "move to first or last item"],
  ["Enter", "connect, select schema for query, or open table"],
  ["Tab", "cycle catalog, result, and query"],
  ["Shift+Tab", "cycle query panes in reverse"],
  ["e", "open the in-app SQL editor"],
  ["Cmd+Enter", "execute the SQL draft"],
  ["Ctrl-G", "edit the SQL draft in $VISUAL or $EDITOR"],
  ["Ctrl-Space", "complete a table or column name"],
  ["r", "rerun the most recent or selected query"],
  ["n / p", "next or previous table page"],
  ["y", "copy selected cell or table name"],
  ["/", "filter the current list"],
  ["?", "show this help"],
  ["q / Esc", "go back, or quit from connections"],
  ["Ctrl-C", "cancel the running query"],
] as const;

export function Help() {
  return (
    <Box flexDirection="column" borderStyle="single" paddingX={1}>
      <Text bold>Keyboard shortcuts</Text>
      {bindings.map(([key, description]) => (
        <Text key={key}>
          {key.padEnd(16)} {description}
        </Text>
      ))}
    </Box>
  );
}
