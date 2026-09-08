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

  test("loads catalog levels without losing the active connection", () => {
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
    expect(connected.mode).toBe("catalog");
    const schemas = reducer(connected, {
      type: "schemasLoaded",
      schemas: [{ schema: "public" }],
      showSystem: false,
    });
    const selected = reducer(schemas, {
      type: "schemaSelected",
      schema: "public",
    });
    expect(selected).toMatchObject({
      selectedSchema: "public",
      expandedSchema: undefined,
      tables: [],
    });
    expect(
      reducer(selected, { type: "openQueryEditor", initialSql: "" }).mode,
    ).toBe("query");
    const tables = reducer(schemas, {
      type: "tablesLoaded",
      schema: "public",
      tables: [{ schema: "public", table: "items", type: "table" }],
    });
    expect(tables).toMatchObject({
      selectedSchema: "public",
      expandedSchema: "public",
      tables: [{ table: "items" }],
    });
    expect(
      reducer(tables, { type: "schemaCollapsed", selectedIndex: 0 }),
    ).toMatchObject({
      selectedSchema: "public",
      expandedSchema: undefined,
      tables: [],
      selectedIndex: 0,
    });
  });

  test("opens and cancels connection switching without losing query state", () => {
    const state = {
      ...initialState,
      current: {
        name: "primary",
        engine: "postgres" as const,
        source: "pg_service" as const,
        host: "localhost",
        port: 5432,
        user: "reader",
      },
      connections: [
        {
          name: "primary",
          engine: "postgres" as const,
          source: "pg_service" as const,
          available: true,
        },
      ],
      mode: "query" as const,
      queryDraft: "SELECT 1",
    };
    const picker = reducer(state, { type: "openConnectionSwitcher" });
    expect(picker).toMatchObject({
      mode: "connections",
      connectionReturnMode: "query",
      current: { name: "primary" },
      queryDraft: "SELECT 1",
    });
    expect(reducer(picker, { type: "cancelConnectionSwitcher" })).toMatchObject(
      {
        mode: "query",
        connectionReturnMode: undefined,
        current: { name: "primary" },
        queryDraft: "SELECT 1",
      },
    );
  });

  test("preserves the draft when replacing an active connection", () => {
    const state = {
      ...initialState,
      queryDraft: "SELECT * FROM items",
      queryCursor: 8,
    };
    expect(
      reducer(state, {
        type: "connectionSucceeded",
        connection: {
          name: "secondary",
          engine: "mysql",
          source: "mylogin",
          host: "localhost",
          port: 3306,
          user: "reader",
        },
        preserveDraft: true,
      }),
    ).toMatchObject({
      mode: "catalog",
      current: { name: "secondary" },
      queryDraft: "SELECT * FROM items",
      queryCursor: 8,
      result: undefined,
    });
  });

  test("keeps the active connection when replacement fails", () => {
    const state = {
      ...initialState,
      current: {
        name: "primary",
        engine: "postgres" as const,
        source: "pg_service" as const,
        host: "localhost",
        port: 5432,
        user: "reader",
      },
    };
    expect(
      reducer(state, {
        type: "connectionFailed",
        error: { message: "failed" },
        preserveCurrent: true,
      }).current?.name,
    ).toBe("primary");
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

  test("replaces a query draft after external editing", () => {
    const state = {
      ...initialState,
      queryDraft: "SELECT 1",
      queryCursor: 3,
    };
    expect(
      reducer(state, { type: "replaceQueryDraft", sql: "SELECT 2" }),
    ).toMatchObject({ queryDraft: "SELECT 2", queryCursor: 8 });
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
