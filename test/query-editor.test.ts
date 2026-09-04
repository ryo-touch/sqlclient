import { describe, expect, test } from "bun:test";

import {
  deleteQueryBackward,
  deleteQueryForward,
  insertQueryText,
  moveQueryCursor,
} from "../src/core/query-editor.ts";

describe("in-app query editor", () => {
  test("inserts pasted multiline text at the cursor", () => {
    expect(insertQueryText("SELECT ", 7, "1\nFROM dual")).toEqual({
      sql: "SELECT 1\nFROM dual",
      cursor: 18,
    });
  });

  test("deletes backward and forward", () => {
    expect(deleteQueryBackward("abc", 2)).toEqual({ sql: "ac", cursor: 1 });
    expect(deleteQueryForward("abc", 1)).toEqual({ sql: "ac", cursor: 1 });
  });

  test("moves vertically while preserving the preferred column when possible", () => {
    const sql = "abcd\nx\n12345";
    expect(moveQueryCursor(sql, 3, "down")).toBe(6);
    expect(moveQueryCursor(sql, 6, "down")).toBe(8);
    expect(moveQueryCursor(sql, 10, "up")).toBe(6);
  });

  test("moves to line boundaries", () => {
    const sql = "first\nsecond";
    expect(moveQueryCursor(sql, 9, "home")).toBe(6);
    expect(moveQueryCursor(sql, 9, "end")).toBe(12);
  });
});
