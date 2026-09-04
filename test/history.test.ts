import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  HISTORY_LIMIT,
  loadHistory,
  parseHistory,
  recordHistory,
  saveHistory,
} from "../src/core/history.ts";
import type { HistoryEntry } from "../src/types.ts";

const entry = (index: number): HistoryEntry => ({
  sql: `SELECT ${index}`,
  connection: "fixture",
  executedAt: new Date(2026, 0, 1, 0, 0, index % 60),
  ok: index % 2 === 0,
});

describe("query history", () => {
  test("parses valid JSONL and warns about invalid lines", () => {
    const parsed = parseHistory(
      `${JSON.stringify({ ...entry(1), executedAt: entry(1).executedAt.toISOString() })}\nnot-json\n`,
    );
    expect(parsed.entries).toHaveLength(1);
    expect(parsed.entries[0]?.executedAt).toBeInstanceOf(Date);
    expect(parsed.warnings).toEqual(["Ignored 1 invalid query history line"]);
  });

  test("stores at most 500 newest entries with private permissions", async () => {
    const directory = await mkdtemp(join(tmpdir(), "sqlclient-history-test-"));
    const path = join(directory, "history.jsonl");
    try {
      await saveHistory(
        Array.from({ length: HISTORY_LIMIT + 5 }, (_, index) => entry(index)),
        path,
      );
      const loaded = await loadHistory(path);
      expect(loaded.entries).toHaveLength(HISTORY_LIMIT);
      expect((await stat(path)).mode & 0o777).toBe(0o600);

      const newest = entry(999);
      const recorded = await recordHistory(newest, path);
      expect(recorded.entries).toHaveLength(HISTORY_LIMIT);
      expect(recorded.entries[0]?.sql).toBe("SELECT 999");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
