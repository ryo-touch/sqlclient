import { useEffect, useMemo, useReducer } from "react";
import { Box, Text, useApp, useInput } from "ink";

import { discoverConnections } from "./core/credentials.ts";
import { initialState, reducer } from "./state.ts";
import { ConnectionList } from "./ui/ConnectionList.tsx";
import { FilterInput } from "./ui/FilterInput.tsx";
import { Header } from "./ui/Header.tsx";

export function App() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const { exit } = useApp();

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

  const visibleConnections = useMemo(() => {
    const filter = state.filter.toLocaleLowerCase();
    return filter === ""
      ? state.connections
      : state.connections.filter((connection) =>
          connection.name.toLocaleLowerCase().includes(filter),
        );
  }, [state.connections, state.filter]);

  useInput((input, key) => {
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
      }
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
        <ConnectionList
          connections={visibleConnections}
          selectedIndex={state.selectedIndex}
        />
      </Box>
      <FilterInput filter={state.filter} editing={state.filterEditing} />
      {state.error ? <Text color="red">{state.error.message}</Text> : null}
      {state.message ? <Text color="yellow">{state.message}</Text> : null}
      {state.warnings.map((warning, index) => (
        <Text color="yellow" key={`${warning}:${index}`}>
          {warning}
        </Text>
      ))}
      <Text dimColor>j/k move · Enter connect · / filter · q quit</Text>
    </Box>
  );
}
