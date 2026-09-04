import { Box, Text } from "ink";

const bindings = [
  ["j / k, arrows", "move up and down"],
  ["h / l", "move catalog pane or result column"],
  ["g / G", "move to first or last item"],
  ["Enter", "open or execute selection"],
  ["Tab", "cycle catalog, result, and query"],
  ["e", "open the in-app SQL editor"],
  ["Cmd+Enter", "execute the SQL draft"],
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
