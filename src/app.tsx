import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import { Box, Text, useApp, useInput } from "ink";

import { discoverConnections } from "./core/credentials.ts";
import { resolveConnection } from "./core/credentials.ts";
import {
  connectDatabase,
  DatabaseConnectionError,
  type DatabaseSession,
} from "./core/connection.ts";
import { initialState, reducer } from "./state.ts";
import { ConnectionList } from "./ui/ConnectionList.tsx";
import { FilterInput } from "./ui/FilterInput.tsx";
import { Header } from "./ui/Header.tsx";

export function App() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const { exit } = useApp();
  const session = useRef<DatabaseSession | undefined>(undefined);

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

      try {
        const connected = await connectDatabase(resolved.connection);
        session.current = connected;
        dispatch({ type: "connectionSucceeded", connection: connected.info });
      } catch (error) {
        dispatch({
          type: "connectionFailed",
          error:
            error instanceof DatabaseConnectionError
              ? error.queryError
              : { message: "Database connection failed" },
        });
      }
    },
    [visibleConnections],
  );

  useInput((input, key) => {
    if (state.running) return;

    if (state.mode === "catalog") {
      if (input === "q" || key.escape) {
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
        readOnlyVerified={state.readOnlyVerified}
      />
      <Box marginTop={1} flexDirection="column">
        {state.mode === "connections" ? (
          <ConnectionList
            connections={visibleConnections}
            selectedIndex={state.selectedIndex}
          />
        ) : (
          <Text dimColor>Connected. Loading catalog…</Text>
        )}
      </Box>
      {state.mode === "connections" ? (
        <FilterInput filter={state.filter} editing={state.filterEditing} />
      ) : null}
      {state.error ? <Text color="red">{state.error.message}</Text> : null}
      {state.message ? <Text color="yellow">{state.message}</Text> : null}
      {state.warnings.map((warning, index) => (
        <Text color="yellow" key={`${warning}:${index}`}>
          {warning}
        </Text>
      ))}
      <Text dimColor>
        {state.mode === "connections"
          ? "j/k move · Enter connect · / filter · q quit"
          : "q disconnect"}
      </Text>
    </Box>
  );
}
