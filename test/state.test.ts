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
});
