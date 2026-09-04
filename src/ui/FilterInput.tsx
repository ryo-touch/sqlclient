import { Text } from "ink";

interface FilterInputProps {
  filter: string;
  editing: boolean;
}

export function FilterInput({ filter, editing }: FilterInputProps) {
  if (!editing && filter === "") return null;
  return (
    <Text color={editing ? "cyan" : undefined}>
      /{filter}
      {editing ? <Text inverse> </Text> : null}
    </Text>
  );
}
