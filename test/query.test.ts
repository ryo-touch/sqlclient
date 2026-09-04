import { describe, expect, test } from "bun:test";

import {
  executeTablePage,
  executeUserQuery,
  normalizeRows,
  PAGE_SIZE,
  USER_QUERY_LIMIT,
} from "../src/core/query.ts";
import type { DatabaseSession } from "../src/core/connection.ts";
import { postgresDialect } from "../src/core/dialect/postgres.ts";

function fakeSession(result: unknown, delayMs = 0): DatabaseSession {
  let cancelled = false;
  const query = async () => {
    if (delayMs > 0) await Bun.sleep(delayMs);
    if (cancelled) throw new Error("cancelled");
    return result;
  };
  return {
    info: {
      name: "fixture",
      engine: "postgres",
      source: "env",
      host: "localhost",
      port: 5432,
      user: "reader",
    },
    readOnlyVerified: true,
    executeCatalog: () => query() as never,
    executeUser: () => query() as never,
    toQueryError: (error) => ({
      message: error instanceof Error ? error.message : "failed",
    }),
    cancelActive: () => {
      cancelled = true;
      return true;
    },
    close: async () => undefined,
  };
}

describe("query result normalization", () => {
  test("keeps Bun values unchanged and preserves NULL separately", () => {
    const date = new Date("2026-01-02T03:04:05Z");
    const object = { nested: true };
    const normalized = normalizeRows(
      [{ id: 1n, nullable: null, created_at: date, payload: object }],
      10,
    );
    expect(normalized.columns).toEqual([
      "id",
      "nullable",
      "created_at",
      "payload",
    ]);
    expect(normalized.rows[0]).toEqual([1n, null, date, object]);
  });

  test("does not retain rows beyond the requested limit", () => {
    const normalized = normalizeRows(
      Array.from({ length: 5 }, (_, index) => ({ index })),
      2,
    );
    expect(normalized.totalRows).toBe(5);
    expect(normalized.rows).toEqual([[0], [1]]);
  });
});

describe("table browsing", () => {
  test("uses one probe row to determine whether another page may exist", async () => {
    const outcome = await executeTablePage(
      fakeSession(Array.from({ length: PAGE_SIZE + 1 }, (_, id) => ({ id }))),
      postgresDialect,
      "public",
      "items",
      0,
    );
    expect(outcome.ok).toBeTrue();
    if (outcome.ok) {
      expect(outcome.result.rows).toHaveLength(PAGE_SIZE);
      expect(outcome.result.hasMore).toBeTrue();
      expect(outcome.result.sql).toContain(`LIMIT ${PAGE_SIZE + 1}`);
    }
  });
});

describe("user queries", () => {
  test("retains 2000 rows while reporting the full returned count", async () => {
    const rows = Array.from({ length: USER_QUERY_LIMIT + 1 }, (_, id) => ({
      id,
    }));
    const outcome = await executeUserQuery(
      fakeSession(rows),
      "SELECT id FROM items",
    );
    expect(outcome.ok).toBeTrue();
    if (outcome.ok) {
      expect(outcome.result.rows).toHaveLength(USER_QUERY_LIMIT);
      expect(outcome.result.rowCount).toBe(USER_QUERY_LIMIT + 1);
      expect(outcome.result.truncated).toBeTrue();
    }
  });

  test("cancels after the timeout", async () => {
    const outcome = await executeUserQuery(
      fakeSession([], 20),
      "SELECT slow",
      1,
    );
    expect(outcome).toMatchObject({ ok: false, timedOut: true });
  });
});
