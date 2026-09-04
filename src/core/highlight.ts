import { getSegments } from "sql-highlight";

import type { Engine } from "../types.ts";

export type SqlSegmentName =
  | "keyword"
  | "identifier"
  | "string"
  | "number"
  | "comment"
  | "special"
  | "function"
  | "bracket"
  | "whitespace";

export interface SqlSegment {
  name: SqlSegmentName;
  content: string;
}

const segmentNames: ReadonlySet<string> = new Set<SqlSegmentName>([
  "keyword",
  "identifier",
  "string",
  "number",
  "comment",
  "special",
  "function",
  "bracket",
  "whitespace",
]);

function segmentName(value: string): SqlSegmentName {
  return segmentNames.has(value) ? (value as SqlSegmentName) : "identifier";
}

export function correctPostgresSegments(
  segments: readonly SqlSegment[],
): SqlSegment[] {
  return segments.map((segment) =>
    segment.name === "string" &&
    segment.content.startsWith('"') &&
    segment.content.endsWith('"')
      ? { ...segment, name: "identifier" }
      : segment,
  );
}

export function highlightSql(sql: string, engine: Engine): SqlSegment[] {
  const segments = getSegments(sql).map((segment) => ({
    name: segmentName(segment.name),
    content: segment.content,
  }));
  return engine === "postgres" ? correctPostgresSegments(segments) : segments;
}
