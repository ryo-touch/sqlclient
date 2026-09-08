import { useInput } from "ink";
import type { Dispatch } from "react";

import { PAGE_SIZE } from "../core/query.ts";
import { cycleQueryFocus } from "../core/query-editor.ts";
import type { Action, AppState } from "../state.ts";
import type { ConnectionListItem } from "../types.ts";
import type { CatalogNode } from "../ui/CatalogTree.tsx";
import type { SessionRef } from "./use-app-actions.ts";

interface AppInputActions {
  connectSelected(connection: ConnectionListItem): Promise<void>;
  runTablePage(schema: string, table: string, offset: number): Promise<void>;
  runUserSql(sql: string): Promise<void>;
  copySelection(): Promise<void>;
  exportResult(): Promise<void>;
  openExternalEditor(): Promise<void>;
  completeIdentifier(): Promise<void>;
  openCatalogNode(node: CatalogNode): Promise<void>;
  expandCatalogSchema(
    node: Extract<CatalogNode, { kind: "schema" }>,
  ): Promise<void>;
  reloadSchemas(showSystem: boolean): Promise<void>;
}

interface UseAppInputOptions extends AppInputActions {
  state: AppState;
  dispatch: Dispatch<Action>;
  session: SessionRef;
  visibleConnections: ConnectionListItem[];
  catalogNodes: CatalogNode[];
  showQueryHistory: boolean;
  exit(): void;
}

export function useAppInput({
  state,
  dispatch,
  session,
  visibleConnections,
  catalogNodes,
  showQueryHistory,
  exit,
  connectSelected,
  runTablePage,
  runUserSql,
  copySelection,
  exportResult,
  openExternalEditor,
  completeIdentifier,
  openCatalogNode,
  expandCatalogSchema,
  reloadSchemas,
}: UseAppInputOptions) {
  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      if (state.running) {
        const connected = session.current;
        dispatch({ type: "showMessage", message: "Cancelling query…" });
        void connected?.cancelActive().then((cancelled) => {
          if (!cancelled) {
            dispatch({
              type: "addWarnings",
              warnings: ["The server did not accept the cancellation request"],
            });
          }
        });
      } else {
        exit();
      }
      return;
    }

    if (
      key.ctrl &&
      input === "x" &&
      state.current &&
      state.mode !== "connections" &&
      state.mode !== "help" &&
      !state.running &&
      key.eventType !== "release"
    ) {
      dispatch({ type: "openConnectionSwitcher" });
      return;
    }

    if (
      key.ctrl &&
      input === "r" &&
      state.current &&
      state.mode !== "connections" &&
      state.mode !== "help" &&
      !state.running &&
      key.eventType !== "release"
    ) {
      const current = state.connections.find(
        (connection) =>
          connection.name === state.current?.name &&
          connection.engine === state.current.engine &&
          connection.source === state.current.source,
      );
      if (current) void connectSelected(current);
      return;
    }

    if (state.mode === "query" && state.queryFocus === "editor") {
      if (key.eventType === "release") return;
      if (key.ctrl && (input === " " || input === "`")) {
        if (!state.running) void completeIdentifier();
      } else if (key.ctrl && input === "g") {
        if (!state.running) void openExternalEditor();
      } else if (key.return && (key.super || key.meta)) {
        if (!state.running && state.queryDraft.trim() !== "") {
          void runUserSql(state.queryDraft);
        }
      } else if (key.tab) {
        dispatch({
          type: "setQueryFocus",
          focus: cycleQueryFocus(
            state.queryFocus,
            key.shift ? "backward" : "forward",
            state.result !== undefined,
            showQueryHistory,
          ),
        });
      } else if (key.escape) {
        dispatch({
          type: "setMode",
          mode: state.result ? "result" : "catalog",
        });
      } else if (key.leftArrow) {
        dispatch({ type: "moveQueryCursor", direction: "left" });
      } else if (key.rightArrow) {
        dispatch({ type: "moveQueryCursor", direction: "right" });
      } else if (key.upArrow) {
        dispatch({ type: "moveQueryCursor", direction: "up" });
      } else if (key.downArrow) {
        dispatch({ type: "moveQueryCursor", direction: "down" });
      } else if (key.home) {
        dispatch({ type: "moveQueryCursor", direction: "home" });
      } else if (key.end) {
        dispatch({ type: "moveQueryCursor", direction: "end" });
      } else if (key.backspace) {
        dispatch({ type: "deleteQueryBackward" });
      } else if (key.delete) {
        dispatch({ type: "deleteQueryForward" });
      } else if (key.return) {
        dispatch({ type: "insertQueryText", text: "\n" });
      } else if (
        input !== "" &&
        !key.ctrl &&
        !key.meta &&
        !key.super &&
        !key.hyper
      ) {
        dispatch({ type: "insertQueryText", text: input });
      }
      return;
    }

    if (state.running) return;

    if (state.mode === "help") {
      if (input === "q" || key.escape || input === "?") {
        dispatch({ type: "closeHelp" });
      }
      return;
    }

    if (!state.filterEditing && input === "?") {
      dispatch({ type: "showHelp" });
      return;
    }

    if (!state.filterEditing && input === "e" && state.current) {
      dispatch({
        type: "openQueryEditor",
        initialSql: state.result?.sql ?? "",
      });
      return;
    }

    if (
      !state.filterEditing &&
      input === "y" &&
      (state.mode === "catalog" ||
        state.mode === "result" ||
        (state.mode === "query" && state.queryFocus === "result"))
    ) {
      void copySelection();
      return;
    }

    if (
      !state.filterEditing &&
      input === "w" &&
      (state.mode === "result" ||
        (state.mode === "query" && state.queryFocus === "result"))
    ) {
      void exportResult();
      return;
    }

    const movementCommands = [...input];
    if (
      !state.filterEditing &&
      movementCommands.length > 1 &&
      movementCommands.every((command) =>
        ["j", "k", "g", "G"].includes(command),
      )
    ) {
      const itemCount =
        state.mode === "connections"
          ? visibleConnections.length
          : state.mode === "result"
            ? (state.result?.rows.length ?? 0)
            : state.mode === "query"
              ? state.queryFocus === "result"
                ? (state.result?.rows.length ?? 0)
                : state.history.length
              : catalogNodes.length;
      for (const command of movementCommands) {
        if (command === "j" || command === "k") {
          dispatch({
            type: "moveSelection",
            delta: command === "j" ? 1 : -1,
            itemCount,
          });
        } else {
          dispatch({
            type: "moveToBoundary",
            boundary: command === "g" ? "first" : "last",
            itemCount,
          });
        }
      }
      return;
    }

    if (state.mode === "result") {
      const rowCount = state.result?.rows.length ?? 0;
      const columnCount = state.result?.columns.length ?? 0;
      if (input === "j" || key.downArrow)
        dispatch({ type: "moveSelection", delta: 1, itemCount: rowCount });
      else if (input === "k" || key.upArrow)
        dispatch({ type: "moveSelection", delta: -1, itemCount: rowCount });
      else if (input === "g")
        dispatch({
          type: "moveToBoundary",
          boundary: "first",
          itemCount: rowCount,
        });
      else if (input === "G")
        dispatch({
          type: "moveToBoundary",
          boundary: "last",
          itemCount: rowCount,
        });
      else if (input === "h")
        dispatch({ type: "moveResultColumn", delta: -1, columnCount });
      else if (input === "l")
        dispatch({ type: "moveResultColumn", delta: 1, columnCount });
      else if (
        input === "n" &&
        state.resultSource?.kind === "table" &&
        state.result?.hasMore
      )
        void runTablePage(
          state.resultSource.schema,
          state.resultSource.table,
          state.result.offset + PAGE_SIZE,
        );
      else if (
        input === "p" &&
        state.resultSource?.kind === "table" &&
        state.result
      )
        void runTablePage(
          state.resultSource.schema,
          state.resultSource.table,
          Math.max(0, state.result.offset - PAGE_SIZE),
        );
      else if (
        input === "r" &&
        state.resultSource?.kind === "table" &&
        state.result
      )
        void runTablePage(
          state.resultSource.schema,
          state.resultSource.table,
          state.result.offset,
        );
      else if (
        input === "r" &&
        state.resultSource?.kind === "query" &&
        state.result
      )
        void runUserSql(state.result.sql);
      else if (key.tab) dispatch({ type: "setMode", mode: "query" });
      else if (input === "q" || key.escape)
        dispatch({ type: "setMode", mode: "catalog" });
      return;
    }

    if (state.mode === "query") {
      if (state.queryFocus === "history") {
        if (input === "j" || key.downArrow)
          dispatch({
            type: "moveSelection",
            delta: 1,
            itemCount: state.history.length,
          });
        else if (input === "k" || key.upArrow)
          dispatch({
            type: "moveSelection",
            delta: -1,
            itemCount: state.history.length,
          });
        else if (input === "g")
          dispatch({
            type: "moveToBoundary",
            boundary: "first",
            itemCount: state.history.length,
          });
        else if (input === "G")
          dispatch({
            type: "moveToBoundary",
            boundary: "last",
            itemCount: state.history.length,
          });
        else if (key.return) {
          const selected = state.history[state.selectedIndex];
          if (selected)
            dispatch({ type: "loadHistoryQuery", sql: selected.sql });
        } else if (input === "r") {
          const selected = state.history[state.selectedIndex];
          if (selected) void runUserSql(selected.sql);
        } else if (key.tab)
          dispatch({
            type: "setQueryFocus",
            focus: cycleQueryFocus(
              state.queryFocus,
              key.shift ? "backward" : "forward",
              state.result !== undefined,
              showQueryHistory,
            ),
          });
        else if (input === "e")
          dispatch({ type: "setQueryFocus", focus: "editor" });
        else if (input === "q" || key.escape)
          dispatch({ type: "setMode", mode: "catalog" });
      } else {
        const rowCount = state.result?.rows.length ?? 0;
        const columnCount = state.result?.columns.length ?? 0;
        if (input === "j" || key.downArrow)
          dispatch({ type: "moveSelection", delta: 1, itemCount: rowCount });
        else if (input === "k" || key.upArrow)
          dispatch({ type: "moveSelection", delta: -1, itemCount: rowCount });
        else if (input === "g")
          dispatch({
            type: "moveToBoundary",
            boundary: "first",
            itemCount: rowCount,
          });
        else if (input === "G")
          dispatch({
            type: "moveToBoundary",
            boundary: "last",
            itemCount: rowCount,
          });
        else if (input === "h")
          dispatch({ type: "moveResultColumn", delta: -1, columnCount });
        else if (input === "l")
          dispatch({ type: "moveResultColumn", delta: 1, columnCount });
        else if (key.tab)
          dispatch({
            type: "setQueryFocus",
            focus: cycleQueryFocus(
              state.queryFocus,
              key.shift ? "backward" : "forward",
              state.result !== undefined,
              showQueryHistory,
            ),
          });
        else if (input === "e")
          dispatch({ type: "setQueryFocus", focus: "editor" });
        else if (input === "q" || key.escape)
          dispatch({ type: "setMode", mode: "catalog" });
      }
      return;
    }

    if (state.mode === "catalog") {
      const itemCount = catalogNodes.length;
      if (state.filterEditing) {
        if (key.escape) dispatch({ type: "clearFilter" });
        else if (key.return) dispatch({ type: "finishFilter" });
        else if (key.backspace || key.delete)
          dispatch({ type: "removeFilterCharacter" });
        else if (input !== "" && !key.ctrl && !key.meta)
          dispatch({ type: "appendFilter", text: input });
      } else if (input === "/") dispatch({ type: "beginFilter" });
      else if (key.tab)
        dispatch({
          type: "setMode",
          mode: state.result ? "result" : "query",
        });
      else if (input === "j" || key.downArrow)
        dispatch({ type: "moveSelection", delta: 1, itemCount });
      else if (input === "k" || key.upArrow)
        dispatch({ type: "moveSelection", delta: -1, itemCount });
      else if (input === "g")
        dispatch({ type: "moveToBoundary", boundary: "first", itemCount });
      else if (input === "G")
        dispatch({ type: "moveToBoundary", boundary: "last", itemCount });
      else if (input === "l" || key.rightArrow) {
        const node = catalogNodes[state.selectedIndex];
        if (node?.kind === "schema") void expandCatalogSchema(node);
      } else if ((input === "h" || key.leftArrow) && state.expandedSchema) {
        const schemaIndex = catalogNodes.findIndex(
          (node) =>
            node.kind === "schema" &&
            node.value.schema === state.expandedSchema,
        );
        dispatch({
          type: "schemaCollapsed",
          selectedIndex: Math.max(0, schemaIndex),
        });
      } else if (input === "s") void reloadSchemas(!state.showSystemSchemas);
      else if (key.return) {
        const node = catalogNodes[state.selectedIndex];
        if (node) void openCatalogNode(node);
      } else if (input === "q" || key.escape) {
        if (state.filter !== "") {
          dispatch({ type: "clearFilter" });
          return;
        }
        const current = session.current;
        session.current = undefined;
        void current?.close();
        dispatch({ type: "returnedToConnections" });
      }
      return;
    }

    if (state.filterEditing) {
      if (key.escape) dispatch({ type: "clearFilter" });
      else if (key.return) dispatch({ type: "finishFilter" });
      else if (key.backspace || key.delete)
        dispatch({ type: "removeFilterCharacter" });
      else if (input !== "" && !key.ctrl && !key.meta)
        dispatch({ type: "appendFilter", text: input });
      return;
    }

    if (input === "/") dispatch({ type: "beginFilter" });
    else if (input === "j" || key.downArrow)
      dispatch({
        type: "moveSelection",
        delta: 1,
        itemCount: visibleConnections.length,
      });
    else if (input === "k" || key.upArrow)
      dispatch({
        type: "moveSelection",
        delta: -1,
        itemCount: visibleConnections.length,
      });
    else if (input === "g")
      dispatch({
        type: "moveToBoundary",
        boundary: "first",
        itemCount: visibleConnections.length,
      });
    else if (input === "G")
      dispatch({
        type: "moveToBoundary",
        boundary: "last",
        itemCount: visibleConnections.length,
      });
    else if (key.return) {
      const selected = visibleConnections[state.selectedIndex];
      if (selected && !selected.available) {
        dispatch({
          type: "showMessage",
          message: selected.unavailableReason ?? "Connection is unavailable",
        });
      } else if (selected) void connectSelected(selected);
    } else if (input === "q" || key.escape) {
      if (state.filter !== "") dispatch({ type: "clearFilter" });
      else if (state.connectionReturnMode)
        dispatch({ type: "cancelConnectionSwitcher" });
      else exit();
    }
  });
}
