import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { exportResultTsv, resultToTsv } from "../src/core/export.ts";
import type { ResultSet } from "../src/types.ts";

const result: ResultSet = {
  columns: ["id", "note", "missing"],
  rows: [[1, 'tab\tnewline\nquote"', null]],
  rowCount: 1,
  hasMore: false,
  elapsedMs: 1,
  sql: "SELECT 1",
  offset: 0,
};

describe("TSV export", () => {
  test("serializes headers, values, quoting, and NULL", () => {
    expect(resultToTsv(result)).toBe(
      'id\tnote\tmissing\n1\t"tab\tnewline\nquote"""\t\n',
    );
  });

  test("preserves Date precision as ISO 8601 while retaining other display formats", () => {
    const typedResult: ResultSet = {
      columns: ["created_at", "bytes", "metadata"],
      rows: [
        [
          new Date("2026-09-08T03:04:05.678Z"),
          new Uint8Array([0xde, 0xad]),
          { count: 1 },
        ],
      ],
      rowCount: 1,
      hasMore: false,
      elapsedMs: 1,
      sql: "SELECT 1",
      offset: 0,
    };

    expect(resultToTsv(typedResult)).toBe(
      'created_at\tbytes\tmetadata\n2026-09-08T03:04:05.678Z\t0xdead\t"{""count"":1}"\n',
    );
  });

  test("writes a private, non-overwriting timestamped file", async () => {
    const directory = await mkdtemp(join(tmpdir(), "sqlclient-export-test-"));
    const now = new Date(2026, 8, 8, 12, 34, 56);
    const first = await exportResultTsv(result, directory, now);
    const second = await exportResultTsv(result, directory, now);

    expect(first.endsWith("sqlclient-result-20260908-123456.tsv")).toBe(true);
    expect(second.endsWith("sqlclient-result-20260908-123456-2.tsv")).toBe(
      true,
    );
    expect(await readFile(first, "utf8")).toBe(resultToTsv(result));
    expect((await stat(first)).mode & 0o777).toBe(0o600);
  });
});
