import { describe, expect, test } from "bun:test";

import {
  cycleQueryFocus,
  cursorPresentation,
  deleteQueryBackward,
  deleteQueryForward,
  insertQueryText,
  moveQueryCursor,
} from "../src/core/query-editor.ts";

describe("in-app query editor", () => {
  test("cycles available panes forward and backward", () => {
    expect(cycleQueryFocus("editor", "forward", true, true)).toBe("result");
    expect(cycleQueryFocus("editor", "backward", true, true)).toBe("history");
    expect(cycleQueryFocus("result", "backward", true, true)).toBe("editor");
    expect(cycleQueryFocus("history", "forward", true, true)).toBe("editor");
  });

  test("skips panes that have no content", () => {
    expect(cycleQueryFocus("editor", "forward", false, true)).toBe("history");
    expect(cycleQueryFocus("editor", "backward", true, false)).toBe("result");
    expect(cycleQueryFocus("editor", "forward", false, false)).toBe("editor");
  });

  test("renders a visible block before a newline cursor position", () => {
    expect(cursorPresentation("\n")).toEqual({
      glyph: " ",
      trailingNewline: "\n",
    });
  });

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
