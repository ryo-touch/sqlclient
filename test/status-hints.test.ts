import { describe, expect, test } from "bun:test";

import {
  fitStatusHints,
  statusHintLine,
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

  // statusHintLine, not renderStatusHints: the query panes spend 16 columns on
  // the "focus: result · " prefix, and testing without it hid a real overflow.
  test("the whole line fits the terminal from 40 columns up", () => {
    for (const { mode, focus } of SURFACES) {
      for (let terminal = 40; terminal <= 200; terminal += 1) {
        const line = statusHintLine(mode, focus, terminal);
        expect(Bun.stringWidth(line)).toBeLessThanOrEqual(terminal - 2);
      }
    }
  });

  test("the way out of the mode survives an 80 column terminal", () => {
    // Either wording of the exit hint counts; which one shows depends on width.
    const exits: Record<string, string[]> = {
      "connections/editor": ["q cancel/quit", "q quit"],
      "catalog/editor": ["q back"],
      "result/editor": ["q catalog", "q back"],
      "query/editor": ["Esc back"],
      "query/result": ["Esc back"],
      "query/history": ["Esc back"],
      "help/editor": ["q/Esc close help"],
    };
    for (const { mode, focus } of SURFACES) {
      const line = statusHintLine(mode, focus, 80);
      expect({
        surface: `${mode}/${focus}`,
        line,
        hasExit: exits[`${mode}/${focus}`]!.some((exit) => line.includes(exit)),
      }).toMatchObject({ hasExit: true });
    }
  });

  test("reaching the other panes survives an 80 column terminal", () => {
    // Entering query mode lands on the editor, so losing Tab there strands the
    // user: the editor pane has no `? help` hint either.
    for (const focus of ["editor", "result", "history"] as QueryFocus[]) {
      const line = statusHintLine("query", focus, 80);
      expect({ focus, line, hasTab: line.includes("Tab panes") }).toMatchObject(
        {
          hasTab: true,
        },
      );
    }
  });

  test("connection controls appear wherever they are accepted", () => {
    for (const { mode, focus } of SURFACES) {
      const line = statusHintLine(mode, focus, 200);
      const accepted = mode !== "connections" && mode !== "help";
      expect(line.includes("Ctrl-X")).toBe(accepted);
      expect(line.includes("Ctrl-R")).toBe(accepted);
    }
  });

  test("query mode hints follow the focused pane", () => {
    const editor = statusHintLine("query", "editor", 200);
    const result = statusHintLine("query", "result", 200);
    const history = statusHintLine("query", "history", 200);
    expect(editor).toContain("Ctrl-Space complete");
    expect(result).toContain("w TSV");
    expect(history).toContain("Enter load");
    expect(editor).not.toContain("w TSV");
  });

  test("result hints keep the editor and rerun keys once they fit", () => {
    for (const columns of [80, 120, 200]) {
      const line = statusHintLine("result", "editor", columns);
      expect(line).toContain("e SQL");
      expect(line).toContain("r rerun");
      expect(line).toContain("Tab query");
    }
  });

  test("every accepted key of a surface is advertised somewhere", () => {
    // The keys the input handler accepts but the row never mentioned: filtering
    // and pane switching in catalog, help outside the editor pane.
    expect(statusHintLine("catalog", "editor", 200)).toContain("/ filter");
    expect(statusHintLine("catalog", "editor", 200)).toContain(
      "Tab query/result",
    );
    expect(statusHintLine("catalog", "editor", 80)).toContain("/ filter");
    for (const { mode, focus } of SURFACES) {
      const line = statusHintLine(mode, focus, 200);
      // help closes with q/Esc; the editor pane takes `?` as text.
      const advertises =
        mode !== "help" && !(mode === "query" && focus === "editor");
      expect({
        surface: `${mode}/${focus}`,
        line,
        hasHelp: line.includes("? help"),
      }).toMatchObject({ hasHelp: advertises });
    }
  });
});

