export type CursorDirection = "left" | "right" | "up" | "down" | "home" | "end";

function clampCursor(sql: string, cursor: number): number {
  return Math.max(0, Math.min(cursor, sql.length));
}

export function insertQueryText(sql: string, cursor: number, text: string) {
  const position = clampCursor(sql, cursor);
  return {
    sql: `${sql.slice(0, position)}${text}${sql.slice(position)}`,
    cursor: position + text.length,
  };
}

export function deleteQueryBackward(sql: string, cursor: number) {
  const position = clampCursor(sql, cursor);
  if (position === 0) return { sql, cursor: position };
  return {
    sql: `${sql.slice(0, position - 1)}${sql.slice(position)}`,
    cursor: position - 1,
  };
}

export function deleteQueryForward(sql: string, cursor: number) {
  const position = clampCursor(sql, cursor);
  if (position === sql.length) return { sql, cursor: position };
  return {
    sql: `${sql.slice(0, position)}${sql.slice(position + 1)}`,
    cursor: position,
  };
}

function lineBounds(sql: string, cursor: number) {
  const position = clampCursor(sql, cursor);
  const start = sql.lastIndexOf("\n", position - 1) + 1;
  const newline = sql.indexOf("\n", position);
  const end = newline === -1 ? sql.length : newline;
  return { position, start, end, column: position - start };
}

export function moveQueryCursor(
  sql: string,
  cursor: number,
  direction: CursorDirection,
): number {
  const line = lineBounds(sql, cursor);
  switch (direction) {
    case "left":
      return Math.max(0, line.position - 1);
    case "right":
      return Math.min(sql.length, line.position + 1);
    case "home":
      return line.start;
    case "end":
      return line.end;
    case "up": {
      if (line.start === 0) return line.position;
      const previousEnd = line.start - 1;
      const previousStart = sql.lastIndexOf("\n", previousEnd - 1) + 1;
      return previousStart + Math.min(line.column, previousEnd - previousStart);
    }
    case "down": {
      if (line.end === sql.length) return line.position;
      const nextStart = line.end + 1;
      const nextNewline = sql.indexOf("\n", nextStart);
      const nextEnd = nextNewline === -1 ? sql.length : nextNewline;
      return nextStart + Math.min(line.column, nextEnd - nextStart);
    }
  }
}
