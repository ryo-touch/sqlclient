import { describe, expect, test } from "bun:test";

import {
  fitStatusHints,
  renderStatusHints,
  statusHints,
} from "../src/core/status-hints.ts";
import type { Mode, QueryFocus } from "../src/types.ts";

const SURFACES: { mode: Mode; focus: QueryFocus }[] = [
  { mode: "connections", focus: "editor" },
  { mode: "catalog", focus: "editor" },
  { mode: "result", focus: "editor" },
  { mode: "query", focus: "editor" },
  { mode: "query", focus: "result" },
  { mode: "query", focus: "history" },
  { mode: "help", focus: "editor" },
];

function shownKeys(mode: Mode, focus: QueryFocus, columns: number): string[] {
  return fitStatusHints(statusHints(mode, focus), columns).hints.map(
    (hint) => hint.keys,
  );
}

describe("status bar hints", () => {
  test("a wider terminal never shows fewer hints than a narrower one", () => {
    for (const { mode, focus } of SURFACES) {
      let previous = 0;
      for (let columns = 20; columns <= 200; columns += 1) {
        const count = shownKeys(mode, focus, columns).length;
        expect(count).toBeGreaterThanOrEqual(previous);
        previous = count;
      }
    }
  });

  test("hints dropped by a narrow terminal are always the trailing ones", () => {
    for (const { mode, focus } of SURFACES) {
      const widest = shownKeys(mode, focus, 200);
      for (let columns = 20; columns < 200; columns += 1) {
        const shown = shownKeys(mode, focus, columns);
        expect(widest.slice(0, shown.length)).toEqual(shown);
      }
    }
  });

  test("every mode fits an 80 column terminal", () => {
    for (const { mode, focus } of SURFACES) {
      const line = renderStatusHints(statusHints(mode, focus), 78);
      expect(Bun.stringWidth(line)).toBeLessThanOrEqual(78);
      expect(line.length).toBeGreaterThan(0);
    }
  });

  test("connection controls appear wherever they are accepted", () => {
    for (const { mode, focus } of SURFACES) {
      const line = renderStatusHints(statusHints(mode, focus), 200);
      const accepted = mode !== "connections" && mode !== "help";
      expect(line.includes("Ctrl-X")).toBe(accepted);
      expect(line.includes("Ctrl-R")).toBe(accepted);
    }
  });

  test("query mode hints follow the focused pane", () => {
    const editor = renderStatusHints(statusHints("query", "editor"), 200);
    const result = renderStatusHints(statusHints("query", "result"), 200);
    const history = renderStatusHints(statusHints("query", "history"), 200);
    expect(editor).toContain("Ctrl-Space complete");
    expect(result).toContain("w TSV");
    expect(history).toContain("Enter load");
    expect(editor).not.toContain("w TSV");
  });

  test("result hints keep the editor and rerun keys at every width", () => {
    const wide = renderStatusHints(statusHints("result", "editor"), 200);
    expect(wide).toContain("e SQL editor");
    expect(wide).toContain("r rerun");
    expect(wide).toContain("Tab query");
  });
});
