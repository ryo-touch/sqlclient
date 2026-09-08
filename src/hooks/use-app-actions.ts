import { useCallback, useMemo, useRef, type Dispatch } from "react";
import type { useApp } from "ink";

import {
  listColumns,
  listSchemas,
  listTables,
  selectSchema,
} from "../core/catalog.ts";
import { copyValue } from "../core/clipboard.ts";
import {
  connectDatabase,
  DatabaseConnectionError,
  sanitizeDatabaseError,
  type DatabaseSession,
} from "../core/connection.ts";
import { resolveConnection } from "../core/credentials.ts";
import { dialectFor } from "../core/dialect/index.ts";
import { exportResultTsv } from "../core/export.ts";
import {
  editSqlExternally,
  resolveEditorCommand,
} from "../core/external-editor.ts";
import { recordHistory } from "../core/history.ts";
import {
  executeTablePage,
  executeUserQuery,
  PAGE_SIZE,
} from "../core/query.ts";
import type { Action, AppState } from "../state.ts";
import type { HistoryEntry } from "../types.ts";
import type { CatalogNode } from "../ui/CatalogTree.tsx";

export interface SessionRef {
  current: DatabaseSession | undefined;
}

interface UseAppActionsOptions {
  state: AppState;
  dispatch: Dispatch<Action>;
  session: SessionRef;
  suspendTerminal: ReturnType<typeof useApp>["suspendTerminal"];
}

export function useAppActions({
  state,
  dispatch,
  session,
  suspendTerminal,
}: UseAppActionsOptions) {
  const historyWrite = useRef<Promise<void>>(Promise.resolve());
  const externalEditorActive = useRef(false);
  const completionCache = useRef(new Map<string, string[]>());

  const visibleConnections = useMemo(() => {
    const filter = state.filter.toLocaleLowerCase();
    return filter === ""
      ? state.connections
      : state.connections.filter((connection) =>
          connection.name.toLocaleLowerCase().includes(filter),
        );
  }, [state.connections, state.filter]);

  const catalogNodes = useMemo<CatalogNode[]>(() => {
    const nodes: CatalogNode[] = [];
    for (const schema of state.schemas) {
      nodes.push({ kind: "schema", value: schema });
      if (schema.schema === state.expandedSchema) {
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
  }, [state.expandedSchema, state.filter, state.schemas, state.tables]);

  const connectSelected = useCallback(
    async (selected: (typeof visibleConnections)[number]) => {
      const replacingCurrent = state.current !== undefined;
      dispatch({ type: "connectionStarted" });
      const resolved = await resolveConnection(selected);
      if (resolved.warnings.length > 0) {
        dispatch({ type: "addWarnings", warnings: resolved.warnings });
      }
      if (!resolved.connection) {
        dispatch({
          type: "connectionFailed",
          error: { message: resolved.error ?? "Connection resolution failed" },
          preserveCurrent: replacingCurrent,
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
          preserveCurrent: replacingCurrent,
        });
        return;
      }

      const previous = session.current;
      session.current = connected;
      await previous?.close().catch(() => undefined);
      dispatch({
        type: "connectionSucceeded",
        connection: connected.info,
        preserveDraft: replacingCurrent,
      });
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
    [dispatch, session, state.current, visibleConnections],
  );

  const showCatalogError = useCallback(
    (error: unknown) => {
      dispatch({ type: "showError", error: sanitizeDatabaseError(error) });
    },
    [dispatch],
  );

  const rememberQuery = useCallback(
    (entry: HistoryEntry) => {
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
    },
    [dispatch],
  );

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
    [dispatch, rememberQuery, session],
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
    [dispatch, rememberQuery, session],
  );

  const copySelection = useCallback(async () => {
    let value: unknown;
    if (
      state.mode === "result" ||
      (state.mode === "query" && state.queryFocus === "result")
    ) {
      value =
        state.result?.rows[state.selectedIndex]?.[state.selectedColumnIndex];
    } else if (state.mode === "catalog") {
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
  }, [catalogNodes, dispatch, state]);

  const exportResult = useCallback(async () => {
    if (!state.result) {
      dispatch({ type: "showMessage", message: "No result to export" });
      return;
    }
    try {
      const path = await exportResultTsv(state.result);
      dispatch({ type: "showMessage", message: `Exported TSV to ${path}` });
    } catch {
      dispatch({
        type: "showError",
        error: { message: "TSV export failed" },
      });
    }
  }, [dispatch, state.result]);

  const openExternalEditor = useCallback(async () => {
    if (externalEditorActive.current) return;
    externalEditorActive.current = true;
    try {
      let edited = "";
      // Ink owns the terminal, so the editor has to borrow it through Ink
      // rather than around it. suspendTerminal erases the current frame,
      // discards renders while the child is up (the clearMessage timer would
      // otherwise paint over it), hands input back, and forces a full redraw
      // on return. Driving raw mode by hand left the render loop running.
      await suspendTerminal(async () => {
        edited = await editSqlExternally(
          state.queryDraft,
          resolveEditorCommand(),
        );
      });
      dispatch({ type: "replaceQueryDraft", sql: edited.trimEnd() });
      dispatch({
        type: "showMessage",
        message: "Updated SQL from external editor",
      });
    } catch (error) {
      dispatch({
        type: "showError",
        error: {
          message:
            error instanceof Error
              ? error.message
              : "External editor could not be opened",
        },
      });
    } finally {
      externalEditorActive.current = false;
    }
  }, [dispatch, state.queryDraft, suspendTerminal]);

  const completeIdentifier = useCallback(async () => {
    const connected = session.current;
    const schema = state.selectedSchema;
    if (!connected || !schema) return;
    const cacheKey = `${connected.info.engine}:${connected.info.name}:${schema}`;
    let candidates = completionCache.current.get(cacheKey);
    if (!candidates) {
      // The first completion runs a real query on the reserved session, so it has
      // to enter the running state like every other catalog read: Ctrl-C must
      // cancel it instead of quitting, and no second query may overwrite it.
      dispatch({ type: "catalogLoading", message: "Loading completions…" });
      try {
        const columns = await listColumns(
          connected,
          dialectFor(connected.info.engine),
          schema,
        );
        candidates = [
          ...new Set(
            columns.flatMap((column) => [column.table, column.column]),
          ),
        ];
        completionCache.current.set(cacheKey, candidates);
      } catch (error) {
        dispatch({ type: "showError", error: sanitizeDatabaseError(error) });
        return;
      }
    }
    dispatch({ type: "completeQueryIdentifier", candidates });
  }, [dispatch, session, state.selectedSchema]);

  const openCatalogNode = useCallback(
    async (node: CatalogNode) => {
      const connected = session.current;
      if (!connected) return;
      const dialect = dialectFor(connected.info.engine);
      try {
        if (node.kind === "schema") {
          dispatch({ type: "catalogLoading", message: "Selecting schema…" });
          await selectSchema(connected, dialect, node.value.schema);
          dispatch({ type: "schemaSelected", schema: node.value.schema });
          dispatch({
            type: "openQueryEditor",
            initialSql: state.result?.sql ?? "",
          });
        } else {
          await runTablePage(node.value.schema, node.value.table, 0);
        }
      } catch (error) {
        showCatalogError(error);
      }
    },
    [dispatch, runTablePage, session, showCatalogError, state.result?.sql],
  );

  const expandCatalogSchema = useCallback(
    async (node: Extract<CatalogNode, { kind: "schema" }>) => {
      const connected = session.current;
      if (!connected || node.value.schema === state.expandedSchema) return;
      const dialect = dialectFor(connected.info.engine);
      dispatch({ type: "catalogLoading", message: "Loading tables…" });
      try {
        await selectSchema(connected, dialect, node.value.schema);
        const tables = await listTables(connected, dialect, node.value.schema);
        dispatch({ type: "tablesLoaded", schema: node.value.schema, tables });
      } catch (error) {
        showCatalogError(error);
      }
    },
    [dispatch, session, showCatalogError, state.expandedSchema],
  );

  const reloadSchemas = useCallback(
    async (showSystem: boolean) => {
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
    },
    [dispatch, session],
  );

  return {
    visibleConnections,
    catalogNodes,
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
  };
}
