import type { DatabaseSession } from "./connection.ts";
import type { Dialect } from "./dialect/index.ts";
import type { QueryError, ResultSet } from "../types.ts";

export const PAGE_SIZE = 200;
export const USER_QUERY_LIMIT = 2_000;
export const QUERY_TIMEOUT_MS = 30_000;

export type QueryOutcome =
  | { ok: true; result: ResultSet }
  | { ok: false; error: QueryError; timedOut: boolean };

interface NormalizedRows {
  columns: string[];
  rows: unknown[][];
  totalRows: number;
}

export function normalizeRows(value: unknown, limit: number): NormalizedRows {
  if (!Array.isArray(value)) return { columns: [], rows: [], totalRows: 0 };
  const totalRows = value.length;
  const first = value[0];
  if (first === undefined) return { columns: [], rows: [], totalRows };

  if (Array.isArray(first)) {
    const columns = first.map((_, index) => `column_${index + 1}`);
    return {
      columns,
      rows: value
        .slice(0, limit)
        .map((row) => (Array.isArray(row) ? row.slice(0, columns.length) : [])),
      totalRows,
    };
  }

  if (typeof first !== "object" || first === null) {
    return {
      columns: ["value"],
      rows: value.slice(0, limit).map((row) => [row]),
      totalRows,
    };
  }

  const columns = Object.keys(first);
  return {
    columns,
    rows: value.slice(0, limit).map((row) => {
      if (typeof row !== "object" || row === null || Array.isArray(row))
        return [];
      const record = row as Readonly<Record<string, unknown>>;
      return columns.map((column) => record[column]);
    }),
    totalRows,
  };
}

async function executeTimed(
  session: DatabaseSession,
  start: () => Promise<unknown>,
  timeoutMs: number,
): Promise<{
  value?: unknown;
  error?: QueryError;
  elapsedMs: number;
  timedOut: boolean;
}> {
  const startedAt = performance.now();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    void session.cancelActive();
  }, timeoutMs);
  try {
    const value = await start();
    if (session.takeCancellation()) {
      return {
        error: { message: timedOut ? "Query timed out" : "Query cancelled" },
        elapsedMs: performance.now() - startedAt,
        timedOut,
      };
    }
    return { value, elapsedMs: performance.now() - startedAt, timedOut };
  } catch (error) {
    const cancelled = session.takeCancellation();
    return {
      error: cancelled
        ? { message: timedOut ? "Query timed out" : "Query cancelled" }
        : session.toQueryError(error),
      elapsedMs: performance.now() - startedAt,
      timedOut,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function executeTablePage(
  session: DatabaseSession,
  dialect: Dialect,
  schema: string,
  table: string,
  offset: number,
  timeoutMs = QUERY_TIMEOUT_MS,
): Promise<QueryOutcome> {
  const safeOffset = Math.max(0, offset);
  const sql = dialect.selectAll(schema, table, PAGE_SIZE + 1, safeOffset);
  const execution = await executeTimed(
    session,
    () => session.executeCatalog(sql),
    timeoutMs,
  );
  if (execution.error) {
    return { ok: false, error: execution.error, timedOut: execution.timedOut };
  }
  const normalized = normalizeRows(execution.value, PAGE_SIZE);
  return {
    ok: true,
    result: {
      columns: normalized.columns,
      rows: normalized.rows,
      rowCount: normalized.rows.length,
      hasMore: normalized.totalRows > PAGE_SIZE,
      elapsedMs: execution.elapsedMs,
      sql,
      offset: safeOffset,
    },
  };
}

export async function executeUserQuery(
  session: DatabaseSession,
  sql: string,
  timeoutMs = QUERY_TIMEOUT_MS,
): Promise<QueryOutcome> {
  const execution = await executeTimed(
    session,
    () => session.executeUser(sql),
    timeoutMs,
  );
  if (execution.error) {
    return { ok: false, error: execution.error, timedOut: execution.timedOut };
  }
  const normalized = normalizeRows(execution.value, USER_QUERY_LIMIT);
  const truncated = normalized.totalRows > USER_QUERY_LIMIT;
  return {
    ok: true,
    result: {
      columns: normalized.columns,
      rows: normalized.rows,
      rowCount: normalized.totalRows,
      hasMore: truncated,
      elapsedMs: execution.elapsedMs,
      sql,
      offset: 0,
      truncated,
    },
  };
}
