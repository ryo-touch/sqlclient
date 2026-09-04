import { describe, expect, test } from "bun:test";

import { formatValue, truncateCell } from "../src/util/format.ts";

describe("display formatting", () => {
  test("distinguishes NULL from the string NULL", () => {
    expect(formatValue(null)).toEqual({ text: "NULL", isNull: true });
    expect(formatValue("NULL")).toEqual({ text: "NULL", isNull: false });
  });

  test("formats dates in local sortable form", () => {
    const value = new Date(2026, 0, 2, 3, 4, 5);
    expect(formatValue(value).text).toBe("2026-01-02 03:04:05");
  });

  test("truncates overflowing cells with an ellipsis", () => {
    expect(truncateCell("abcdef", 4)).toBe("abc…");
    expect(truncateCell("ab", 4)).toBe("ab  ");
  });
});
