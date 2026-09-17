import { describe, expect, mock, test } from "bun:test";
import type { Key } from "ink";

import { initialState, type Action, type AppState } from "../src/state.ts";
import type { ResultSet } from "../src/types.ts";

// The input map is the one place where a keybinding can be wired to the wrong
// action without a type error, and `useAppInput` reaches Ink only for
// `useInput`. Handing the callback back instead of rendering it exercises every
// branch without a terminal.
let handler: ((input: string, key: Key) => void) | undefined;

void mock.module("ink", () => ({
  useInput(callback: (input: string, key: Key) => void) {
    handler = callback;
  },
}));

const { useAppInput } = await import("../src/hooks/use-app-input.ts");

const NO_KEY: Key = {
  upArrow: false,
  downArrow: false,
  leftArrow: false,
  rightArrow: false,
  pageDown: false,
  pageUp: false,
  home: false,
  end: false,
  return: false,
  escape: false,
  ctrl: false,
  shift: false,
  tab: false,
  backspace: false,
  delete: false,
  meta: false,
  super: false,
  hyper: false,
  capsLock: false,
  numLock: false,
};

const RESULT: ResultSet = {
  columns: ["id"],
  rows: [[1]],
  rowCount: 1,
  hasMore: false,
  elapsedMs: 1,
  sql: "SELECT 1",
  offset: 0,
};

interface Pressed {
  actions: Action[];
  called: string[];
}

/**
 * Sends one key to the handler over `state` and reports what it did: the
 * dispatched actions and the names of the async operations it started.
 */
function press(
  state: Partial<AppState>,
  input: string,
  key: Partial<Key> = {},
  options: { showQueryHistory?: boolean } = {},
): Pressed {
  const actions: Action[] = [];
  const called: string[] = [];
  const record = (name: string) => async () => {
    called.push(name);
  };

  useAppInput({
    state: { ...initialState, ...state },
    dispatch: (action) => actions.push(action),
    session: { current: undefined },
    visibleConnections: [],
    catalogNodes: [],
    showQueryHistory: options.showQueryHistory ?? false,
    exit: () => called.push("exit"),
    connectSelected: record("connectSelected"),
    runTablePage: record("runTablePage"),
    runUserSql: record("runUserSql"),
    copySelection: record("copySelection"),
    exportResult: record("exportResult"),
    openExternalEditor: record("openExternalEditor"),
    completeIdentifier: record("completeIdentifier"),
    openCatalogNode: record("openCatalogNode"),
    expandCatalogSchema: record("expandCatalogSchema"),
    reloadSchemas: record("reloadSchemas"),
  });

  handler?.(input, { ...NO_KEY, ...key });
  return { actions, called };
}

const EDITOR: Partial<AppState> = {
  mode: "query",
  queryFocus: "editor",
  queryDraft: "SELECT cust",
  queryCursor: 11,
  result: RESULT,
};

describe("query editor keys", () => {
  test("Tab completes the identifier instead of leaving the pane", () => {
    const { actions, called } = press(EDITOR, "", { tab: true });
    expect(called).toEqual(["completeIdentifier"]);
    expect(actions).toEqual([]);
  });

  test("Tab does not insert a tab character into the draft", () => {
    const { actions } = press(EDITOR, "\t", { tab: true });
    expect(actions).toEqual([]);
  });

  test("Tab is ignored while a query is in flight", () => {
    const { called } = press({ ...EDITOR, running: true }, "", { tab: true });
    expect(called).toEqual([]);
  });

  test("Ctrl-O leaves the editor for the next pane", () => {
    const { actions } = press(EDITOR, "o", { ctrl: true });
    expect(actions).toEqual([{ type: "setQueryFocus", focus: "result" }]);
  });

  test("Ctrl-O stays put when the editor is the only pane", () => {
    const { actions } = press(
      { ...EDITOR, result: undefined },
      "o",
      { ctrl: true },
      { showQueryHistory: false },
    );
    expect(actions).toEqual([{ type: "setQueryFocus", focus: "editor" }]);
  });

  test("Ctrl-Space no longer completes: macOS takes it before the app sees it", () => {
    const { actions, called } = press(EDITOR, " ", { ctrl: true });
    expect(called).toEqual([]);
    expect(actions).toEqual([]);
  });

  test("Shift+Tab completes like Tab now that the reverse ring is gone", () => {
    const { called } = press(EDITOR, "", { tab: true, shift: true });
    expect(called).toEqual(["completeIdentifier"]);
  });
});

describe("pane keys outside the editor", () => {
  test("Tab and Ctrl-O cycle the query panes the same way", () => {
    const state: Partial<AppState> = {
      mode: "query",
      queryFocus: "result",
      result: RESULT,
    };
    const tab = press(state, "", { tab: true }, { showQueryHistory: true });
    const ctrlO = press(state, "o", { ctrl: true }, { showQueryHistory: true });
    expect(tab.actions).toEqual([{ type: "setQueryFocus", focus: "history" }]);
    expect(ctrlO.actions).toEqual(tab.actions);
  });

  test("Ctrl-O moves on from catalog and result like Tab", () => {
    expect(press({ mode: "catalog" }, "o", { ctrl: true }).actions).toEqual([
      { type: "setMode", mode: "query" },
    ]);
    expect(
      press({ mode: "result", result: RESULT }, "o", { ctrl: true }).actions,
    ).toEqual([{ type: "setMode", mode: "query" }]);
  });

  test("Ctrl-O does not disturb a catalog filter being typed", () => {
    const { actions } = press(
      { mode: "catalog", filterEditing: true, filter: "ord" },
      "o",
      { ctrl: true },
    );
    expect(actions).toEqual([]);
  });
});
