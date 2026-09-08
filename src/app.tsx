import { useEffect, useReducer, useRef, useState } from "react";
import { Box, Text, useApp, useStdout } from "ink";

import type { DatabaseSession } from "./core/connection.ts";
import { discoverConnections } from "./core/credentials.ts";
import { loadHistory } from "./core/history.ts";
import { queryWorkbenchLayout } from "./core/query-editor.ts";
import { useAppActions } from "./hooks/use-app-actions.ts";
import { useAppInput } from "./hooks/use-app-input.ts";
import { initialState, reducer } from "./state.ts";
import { CatalogTree } from "./ui/CatalogTree.tsx";
import { ConnectionList } from "./ui/ConnectionList.tsx";
import { FilterInput } from "./ui/FilterInput.tsx";
import { Header } from "./ui/Header.tsx";
import { Help } from "./ui/Help.tsx";
import { QueryWorkbench } from "./ui/QueryWorkbench.tsx";
import { ResultGrid } from "./ui/ResultGrid.tsx";
import { StatusBar } from "./ui/StatusBar.tsx";

export function App() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const { exit, suspendTerminal } = useApp();
  const { stdout } = useStdout();
  const session = useRef<DatabaseSession | undefined>(undefined);
  const [runningSeconds, setRunningSeconds] = useState(0);
  const showQueryHistory = queryWorkbenchLayout(
    stdout.rows ?? 24,
    state.history.length > 0,
  ).showHistory;

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

  useEffect(() => {
    if (
      state.mode === "query" &&
      state.queryFocus === "history" &&
      !showQueryHistory
    ) {
      dispatch({ type: "setQueryFocus", focus: "editor" });
    }
  }, [showQueryHistory, state.mode, state.queryFocus]);

  const actions = useAppActions({
    state,
    dispatch,
    session,
    suspendTerminal,
  });

  useAppInput({
    state,
    dispatch,
    session,
    showQueryHistory,
    exit,
    ...actions,
  });

  return (
    <Box flexDirection="column" paddingX={1}>
      <Header
        current={state.current}
        schema={state.selectedSchema}
        table={
          state.resultSource?.kind === "table" &&
          state.resultSource.schema === state.selectedSchema
            ? state.resultSource.table
            : undefined
        }
      />
      <Box marginTop={1} flexDirection="column">
        {state.mode === "help" ? (
          <Help />
        ) : state.mode === "connections" ? (
          <ConnectionList
            connections={actions.visibleConnections}
            selectedIndex={state.selectedIndex}
            activeConnection={state.current}
          />
        ) : state.mode === "catalog" ? (
          <CatalogTree
            nodes={actions.catalogNodes}
            selectedIndex={state.selectedIndex}
            selectedSchema={state.selectedSchema}
            expandedSchema={state.expandedSchema}
            selectedTable={
              state.resultSource?.kind === "table" &&
              state.resultSource.schema === state.selectedSchema
                ? state.resultSource.table
                : undefined
            }
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
