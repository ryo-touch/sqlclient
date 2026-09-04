import { describe, expect, test } from "bun:test";

import { highlightSql } from "../src/core/highlight.ts";

describe("SQL highlighting", () => {
  test("corrects PostgreSQL double-quoted identifiers", () => {
    const segments = highlightSql(
      `SELECT "order"::text FROM items WHERE name ILIKE 'a%'`,
      "postgres",
    );
    expect(segments).toContainEqual({ name: "identifier", content: '"order"' });
    expect(segments).toContainEqual({ name: "keyword", content: "ILIKE" });
    expect(segments.filter((segment) => segment.content === ":")).toEqual([
      { name: "special", content: ":" },
      { name: "special", content: ":" },
    ]);
  });

  test("keeps PostgreSQL string literals as strings", () => {
    expect(highlightSql(`SELECT 'quoted'`, "postgres")).toContainEqual({
      name: "string",
      content: "'quoted'",
    });
  });

  test("recognizes MySQL identifiers and compound keywords", () => {
    const segments = highlightSql(
      "SELECT `order` FROM left_table LEFT JOIN right_table ON 1 = 1",
      "mysql",
    );
    expect(segments).toContainEqual({ name: "identifier", content: "`order`" });
    expect(segments).toContainEqual({ name: "keyword", content: "LEFT JOIN" });
  });

  test("does not introduce ANSI escape sequences", () => {
    expect(
      highlightSql("SELECT 1", "postgres").some((segment) =>
        segment.content.includes("\u001b"),
      ),
    ).toBeFalse();
  });
});
