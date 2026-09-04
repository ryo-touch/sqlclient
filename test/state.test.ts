import { describe, expect, test } from "bun:test";

import { initialState, reducer } from "../src/state.ts";

describe("application reducer", () => {
  test("applies repeated movement operations to the latest state", () => {
    const once = reducer(initialState, {
      type: "moveSelection",
      delta: 1,
      itemCount: 5,
    });
    const twice = reducer(once, {
      type: "moveSelection",
      delta: 1,
      itemCount: 5,
    });
    expect(twice.selectedIndex).toBe(2);
  });

  test("clamps selection when moving beyond a boundary", () => {
    const state = { ...initialState, selectedIndex: 2 };
    expect(
      reducer(state, { type: "moveSelection", delta: 10, itemCount: 3 })
        .selectedIndex,
    ).toBe(2);
    expect(
      reducer(state, { type: "moveSelection", delta: -10, itemCount: 3 })
        .selectedIndex,
    ).toBe(0);
  });

  test("filter edits reset selection", () => {
    const state = { ...initialState, selectedIndex: 3, filter: "tab" };
    expect(reducer(state, { type: "appendFilter", text: "l" })).toMatchObject({
      filter: "tabl",
      selectedIndex: 0,
      filterEditing: false,
    });
  });

  test("loads catalog levels without losing the verified connection", () => {
    const connected = reducer(initialState, {
      type: "connectionSucceeded",
      connection: {
        name: "fixture",
        engine: "postgres",
        source: "env",
        host: "localhost",
        port: 5432,
        user: "reader",
      },
    });
    const schemas = reducer(connected, {
      type: "schemasLoaded",
      schemas: [{ schema: "public" }],
      showSystem: false,
    });
    const tables = reducer(schemas, {
      type: "tablesLoaded",
      schema: "public",
      tables: [{ schema: "public", table: "items", type: "table" }],
    });
    expect(tables).toMatchObject({
      readOnlyVerified: true,
      selectedSchema: "public",
      tables: [{ table: "items" }],
    });
    expect(reducer(tables, { type: "schemaCollapsed" })).toMatchObject({
      selectedSchema: undefined,
      selectedTable: undefined,
      tables: [],
      columns: [],
    });
  });

  test("returns from help to the mode that opened it", () => {
    const resultState = { ...initialState, mode: "result" as const };
    const help = reducer(resultState, { type: "showHelp" });
    expect(help.mode).toBe("help");
    expect(reducer(help, { type: "closeHelp" }).mode).toBe("result");
  });

  test("edits a query draft through reducer operations", () => {
    const opened = reducer(initialState, {
      type: "openQueryEditor",
      initialSql: "SELECT 1",
    });
    const inserted = reducer(opened, {
      type: "insertQueryText",
      text: "\nFROM dual",
    });
    const moved = reducer(inserted, {
      type: "moveQueryCursor",
      direction: "home",
    });
    expect(inserted.queryDraft).toBe("SELECT 1\nFROM dual");
    expect(moved.queryCursor).toBe(9);
    expect(moved.queryFocus).toBe("editor");
  });

  test("keeps the split query workbench open after execution", () => {
    const opened = reducer(initialState, {
      type: "openQueryEditor",
      initialSql: "SELECT 1",
    });
    const completed = reducer(opened, {
      type: "querySucceeded",
      source: { kind: "query" },
      result: {
        columns: ["value"],
        rows: [[1]],
        rowCount: 1,
        hasMore: false,
        elapsedMs: 1,
        sql: "SELECT 1",
        offset: 0,
      },
    });
    expect(completed).toMatchObject({
      mode: "query",
      queryDraft: "SELECT 1",
      result: { rows: [[1]] },
    });
  });

  test("changes the active query pane explicitly", () => {
    const state = reducer(initialState, {
      type: "setQueryFocus",
      focus: "result",
    });
    expect(state.queryFocus).toBe("result");
    expect(state.selectedIndex).toBe(0);
  });
});
