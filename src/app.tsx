import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { Box, Text, useApp, useInput } from "ink";

import { discoverConnections } from "./core/credentials.ts";
import { resolveConnection } from "./core/credentials.ts";
import {
  connectDatabase,
  DatabaseConnectionError,
  sanitizeDatabaseError,
  type DatabaseSession,
} from "./core/connection.ts";
import {
  listColumns,
  listSchemas,
  listTables,
  selectSchema,
} from "./core/catalog.ts";
import { dialectFor } from "./core/dialect/index.ts";
import { executeTablePage, executeUserQuery, PAGE_SIZE } from "./core/query.ts";
import { cycleQueryFocus } from "./core/query-editor.ts";
import { loadHistory, recordHistory } from "./core/history.ts";
import { copyValue } from "./core/clipboard.ts";
import type { HistoryEntry } from "./types.ts";
import { initialState, reducer } from "./state.ts";
import { ConnectionList } from "./ui/ConnectionList.tsx";
import { FilterInput } from "./ui/FilterInput.tsx";
import { Header } from "./ui/Header.tsx";
import { CatalogTree, type CatalogNode } from "./ui/CatalogTree.tsx";
import { ResultGrid } from "./ui/ResultGrid.tsx";
import { QueryWorkbench } from "./ui/QueryWorkbench.tsx";
import { Help } from "./ui/Help.tsx";
import { StatusBar } from "./ui/StatusBar.tsx";

export function App() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const { exit } = useApp();
  const session = useRef<DatabaseSession | undefined>(undefined);
  const historyWrite = useRef<Promise<void>>(Promise.resolve());
  const [runningSeconds, setRunningSeconds] = useState(0);

  useEffect(() => {
    void discoverConnections()
      .then((result) => {
        dispatch({ type: "connectionsLoaded", ...result });
      })
      .catch(() => {
        dispatch({
          type: "showError",
          error: { message: "Connection discovery failed" },
        });
      });
  }, []);

  useEffect(() => {
    void loadHistory()
      .then((loaded) => {
        dispatch({
          type: "historyLoaded",
          history: loaded.entries,
          warnings: loaded.warnings,
        });
      })
      .catch(() => {
        dispatch({
          type: "addWarnings",
          warnings: ["The query history could not be read"],
        });
      });
  }, []);

  useEffect(() => {
    if (!state.running) {
      setRunningSeconds(0);
      return;
    }
    const startedAt = performance.now();
    const interval = setInterval(() => {
      setRunningSeconds((performance.now() - startedAt) / 1_000);
    }, 100);
    return () => clearInterval(interval);
  }, [state.running]);

  useEffect(() => {
    if (state.running || !state.message) return;
    const timeout = setTimeout(() => dispatch({ type: "clearMessage" }), 3_000);
    return () => clearTimeout(timeout);
  }, [state.message, state.running]);

  useEffect(
    () => () => {
      void session.current?.close();
    },
    [],
  );

  const visibleConnections = useMemo(() => {
    const filter = state.filter.toLocaleLowerCase();
    return filter === ""
      ? state.connections
      : state.connections.filter((connection) =>
          connection.name.toLocaleLowerCase().includes(filter),
        );
  }, [state.connections, state.filter]);

  const connectSelected = useCallback(
    async (selected: (typeof visibleConnections)[number]) => {
      dispatch({ type: "connectionStarted" });
      const resolved = await resolveConnection(selected);
      if (resolved.warnings.length > 0) {
        dispatch({ type: "addWarnings", warnings: resolved.warnings });
      }
      if (!resolved.connection) {
        dispatch({
          type: "connectionFailed",
          error: { message: resolved.error ?? "Connection resolution failed" },
        });
        return;
      }

      let connected: DatabaseSession;
      try {
        connected = await connectDatabase(resolved.connection);
      } catch (error) {
        dispatch({
          type: "connectionFailed",
          error:
            error instanceof DatabaseConnectionError
              ? error.queryError
              : { message: "Database connection failed" },
        });
        return;
      }

      session.current = connected;
      dispatch({ type: "connectionSucceeded", connection: connected.info });
      dispatch({ type: "catalogLoading", message: "Loading schemas…" });
      try {
        const schemas = await listSchemas(
          connected,
          dialectFor(connected.info.engine),
        );
        dispatch({ type: "schemasLoaded", schemas, showSystem: false });
      } catch (error) {
        dispatch({ type: "showError", error: sanitizeDatabaseError(error) });
      }
    },
    [visibleConnections],
  );

  const catalogNodes = useMemo<CatalogNode[]>(() => {
    const nodes: CatalogNode[] = [];
    for (const schema of state.schemas) {
      nodes.push({ kind: "schema", value: schema });
      if (schema.schema === state.selectedSchema) {
        nodes.push(
          ...state.tables.map((table) => ({
            kind: "table" as const,
            value: table,
          })),
        );
      }
    }
    const filter = state.filter.toLocaleLowerCase();
    return filter === ""
      ? nodes
      : nodes.filter((node) =>
          (node.kind === "schema" ? node.value.schema : node.value.table)
            .toLocaleLowerCase()
            .includes(filter),
        );
  }, [state.filter, state.schemas, state.selectedSchema, state.tables]);

  const visibleColumns = useMemo(() => {
    const filter = state.filter.toLocaleLowerCase();
    return filter === ""
      ? state.columns
      : state.columns.filter((column) =>
          column.name.toLocaleLowerCase().includes(filter),
        );
  }, [state.columns, state.filter]);

  const showCatalogError = useCallback((error: unknown) => {
    dispatch({ type: "showError", error: sanitizeDatabaseError(error) });
  }, []);

  const rememberQuery = useCallback((entry: HistoryEntry) => {
    dispatch({ type: "historyRecorded", entry });
    historyWrite.current = historyWrite.current
      .then(async () => {
        const saved = await recordHistory(entry);
        if (saved.warnings.length > 0) {
          dispatch({ type: "addWarnings", warnings: saved.warnings });
        }
      })
      .catch(() => {
        dispatch({
          type: "addWarnings",
          warnings: ["The query history could not be saved"],
        });
      });
  }, []);

  const runTablePage = useCallback(
    async (schema: string, table: string, offset: number) => {
      const connected = session.current;
      if (!connected) return;
      dispatch({ type: "queryStarted", message: "Running table query…" });
      const outcome = await executeTablePage(
        connected,
        dialectFor(connected.info.engine),
        schema,
        table,
        offset,
      );
      const sql = outcome.ok
        ? outcome.result.sql
        : dialectFor(connected.info.engine).selectAll(
            schema,
            table,
            PAGE_SIZE + 1,
            Math.max(0, offset),
          );
      rememberQuery({
        sql,
        connection: connected.info.name,
        executedAt: new Date(),
        ok: outcome.ok,
      });
      if (outcome.ok) {
        dispatch({
          type: "querySucceeded",
          result: outcome.result,
          source: { kind: "table", schema, table },
        });
      } else {
        dispatch({ type: "queryFailed", error: outcome.error });
      }
    },
    [rememberQuery],
  );

  const runUserSql = useCallback(
    async (sql: string) => {
      const connected = session.current;
      if (!connected) return;
      dispatch({ type: "queryStarted", message: "Running query…" });
      const outcome = await executeUserQuery(connected, sql);
      rememberQuery({
        sql,
        connection: connected.info.name,
        executedAt: new Date(),
        ok: outcome.ok,
      });
      if (outcome.ok) {
        dispatch({
          type: "querySucceeded",
          result: outcome.result,
          source: { kind: "query" },
        });
      } else {
        dispatch({ type: "queryFailed", error: outcome.error });
      }
    },
    [rememberQuery],
  );

  const copySelection = useCallback(async () => {
    let value: unknown;
    if (
      state.mode === "result" ||
      (state.mode === "query" && state.queryFocus === "result")
    ) {
      value =
        state.result?.rows[state.selectedIndex]?.[state.selectedColumnIndex];
    } else if (state.mode === "catalog" && state.catalogPane === "schemas") {
      const node = catalogNodes[state.selectedIndex];
      if (node?.kind === "table") value = node.value.table;
    }
    if (value === undefined) {
      dispatch({ type: "showMessage", message: "Nothing selected to copy" });
      return;
    }
    try {
      await copyValue(value);
      dispatch({ type: "showMessage", message: "Copied to clipboard" });
    } catch {
      dispatch({
        type: "showError",
        error: { message: "Clipboard copy failed" },
      });
    }
  }, [catalogNodes, state]);

  const openCatalogNode = useCallback(
    async (node: CatalogNode) => {
      const connected = session.current;
      if (!connected) return;
      const dialect = dialectFor(connected.info.engine);
      try {
        if (node.kind === "schema") {
          if (node.value.schema === state.selectedSchema) {
            dispatch({ type: "schemaCollapsed" });
            return;
          }
          dispatch({ type: "catalogLoading", message: "Loading tables…" });
          await selectSchema(connected, dialect, node.value.schema);
          const tables = await listTables(
            connected,
            dialect,
            node.value.schema,
          );
          dispatch({ type: "tablesLoaded", schema: node.value.schema, tables });
        } else {
          dispatch({ type: "catalogLoading", message: "Loading columns…" });
          const columns = await listColumns(
            connected,
            dialect,
            node.value.schema,
            node.value.table,
          );
          dispatch({ type: "columnsLoaded", table: node.value.table, columns });
          await runTablePage(node.value.schema, node.value.table, 0);
        }
      } catch (error) {
        showCatalogError(error);
      }
    },
    [runTablePage, showCatalogError, state.selectedSchema],
  );

  const reloadSchemas = useCallback(async (showSystem: boolean) => {
    const connected = session.current;
    if (!connected) return;
    dispatch({ type: "catalogLoading", message: "Loading schemas…" });
    try {
      const schemas = await listSchemas(
        connected,
        dialectFor(connected.info.engine),
        showSystem,
      );
      dispatch({ type: "schemasLoaded", schemas, showSystem });
    } catch (error) {
      dispatch({ type: "showError", error: sanitizeDatabaseError(error) });
    }
  }, []);

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

    if (state.mode === "query" && state.queryFocus === "editor") {
      if (key.eventType === "release") return;
      if (key.return && (key.super || key.meta)) {
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
            state.history.length > 0,
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
              : state.catalogPane === "schemas"
                ? catalogNodes.length
                : visibleColumns.length;
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
              state.history.length > 0,
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
              state.history.length > 0,
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
      const itemCount =
        state.catalogPane === "schemas"
          ? catalogNodes.length
          : visibleColumns.length;
      if (state.filterEditing) {
        if (key.escape) dispatch({ type: "clearFilter" });
        else if (key.return) dispatch({ type: "finishFilter" });
        else if (key.backspace || key.delete)
          dispatch({ type: "removeFilterCharacter" });
        else if (input !== "" && !key.ctrl && !key.meta)
          dispatch({ type: "appendFilter", text: input });
      } else if (input === "/") dispatch({ type: "beginFilter" });
      else if (key.tab)
        dispatch({ type: "setMode", mode: state.result ? "result" : "query" });
      else if (input === "j" || key.downArrow)
        dispatch({ type: "moveSelection", delta: 1, itemCount });
      else if (input === "k" || key.upArrow)
        dispatch({ type: "moveSelection", delta: -1, itemCount });
      else if (input === "g")
        dispatch({ type: "moveToBoundary", boundary: "first", itemCount });
      else if (input === "G")
        dispatch({ type: "moveToBoundary", boundary: "last", itemCount });
      else if (input === "h")
        dispatch({ type: "setCatalogPane", pane: "schemas" });
      else if (input === "l")
        dispatch({ type: "setCatalogPane", pane: "tables" });
      else if (input === "s") void reloadSchemas(!state.showSystemSchemas);
      else if (key.return && state.catalogPane === "schemas") {
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
      else exit();
    }
  });

  return (
    <Box flexDirection="column" paddingX={1}>
      <Header
        current={state.current}
        schema={state.selectedSchema}
        readOnlyVerified={state.readOnlyVerified}
      />
      <Box marginTop={1} flexDirection="column">
        {state.mode === "help" ? (
          <Help />
        ) : state.mode === "connections" ? (
          <ConnectionList
            connections={visibleConnections}
            selectedIndex={state.selectedIndex}
          />
        ) : state.mode === "catalog" ? (
          <CatalogTree
            nodes={catalogNodes}
            columns={visibleColumns}
            selectedIndex={state.selectedIndex}
            activePane={state.catalogPane}
            selectedSchema={state.selectedSchema}
            selectedTable={state.selectedTable}
          />
        ) : state.mode === "result" && state.result ? (
          <ResultGrid
            result={state.result}
            selectedRow={state.selectedIndex}
            selectedColumn={state.selectedColumnIndex}
            columnOffset={state.columnOffset}
          />
        ) : state.current ? (
          <QueryWorkbench
            engine={state.current.engine}
            sql={state.queryDraft}
            cursor={state.queryCursor}
            focus={state.queryFocus}
            result={state.result}
            history={state.history}
            selectedIndex={state.selectedIndex}
            selectedColumn={state.selectedColumnIndex}
            columnOffset={state.columnOffset}
          />
        ) : (
          <Text dimColor>No query.</Text>
        )}
      </Box>
      {state.mode === "connections" || state.mode === "catalog" ? (
        <FilterInput filter={state.filter} editing={state.filterEditing} />
      ) : null}
      {state.warnings.length > 0 ? (
        <Text color="yellow">{state.warnings.at(-1)}</Text>
      ) : null}
      <StatusBar
        mode={state.mode}
        running={state.running}
        runningSeconds={runningSeconds}
        message={state.message}
        error={state.error}
        queryFocus={state.mode === "query" ? state.queryFocus : undefined}
      />
    </Box>
  );
}
