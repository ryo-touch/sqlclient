import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import { Box, Text, useApp, useInput } from "ink";

import { discoverConnections } from "./core/credentials.ts";
import { resolveConnection } from "./core/credentials.ts";
import {
  connectDatabase,
  DatabaseConnectionError,
  sanitizeDatabaseError,
  type DatabaseSession,
} from "./core/connection.ts";
import { listColumns, listSchemas, listTables } from "./core/catalog.ts";
import { dialectFor } from "./core/dialect/index.ts";
import { initialState, reducer } from "./state.ts";
import { ConnectionList } from "./ui/ConnectionList.tsx";
import { FilterInput } from "./ui/FilterInput.tsx";
import { Header } from "./ui/Header.tsx";
import { CatalogTree, type CatalogNode } from "./ui/CatalogTree.tsx";

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

  const openCatalogNode = useCallback(
    async (node: CatalogNode) => {
      const connected = session.current;
      if (!connected) return;
      const dialect = dialectFor(connected.info.engine);
      try {
        if (node.kind === "schema") {
          dispatch({ type: "catalogLoading", message: "Loading tables…" });
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
        }
      } catch (error) {
        showCatalogError(error);
      }
    },
    [showCatalogError],
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
    if (state.running) return;

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
        readOnlyVerified={state.readOnlyVerified}
      />
      <Box marginTop={1} flexDirection="column">
        {state.mode === "connections" ? (
          <ConnectionList
            connections={visibleConnections}
            selectedIndex={state.selectedIndex}
          />
        ) : (
          <CatalogTree
            nodes={catalogNodes}
            columns={visibleColumns}
            selectedIndex={state.selectedIndex}
            activePane={state.catalogPane}
            selectedSchema={state.selectedSchema}
            selectedTable={state.selectedTable}
          />
        )}
      </Box>
      {state.mode === "connections" || state.mode === "catalog" ? (
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
          : "j/k move · h/l pane · Enter expand · s system · / filter · q back"}
      </Text>
    </Box>
  );
}
