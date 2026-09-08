import type { DatabaseSession } from "./connection.ts";
import type { Dialect } from "./dialect/index.ts";
import type {
  ColumnRef,
  ConnectionSummary,
  SchemaRef,
  TableRef,
} from "../types.ts";

function records(
  value: unknown,
): ReadonlyArray<Readonly<Record<string, unknown>>> {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (row): row is Readonly<Record<string, unknown>> =>
      typeof row === "object" && row !== null && !Array.isArray(row),
  );
}

function text(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function field(row: Readonly<Record<string, unknown>>, name: string): unknown {
  if (Object.hasOwn(row, name)) return row[name];
  const matchingKey = Object.keys(row).find(
    (key) => key.toLowerCase() === name.toLowerCase(),
  );
  return matchingKey === undefined ? undefined : row[matchingKey];
}

function approximateRows(value: unknown): number | undefined {
  if (typeof value === "bigint") {
    const converted = Number(value);
    return Number.isSafeInteger(converted) ? converted : undefined;
  }
  if (typeof value === "number")
    return Number.isFinite(value) ? Math.max(0, Math.round(value)) : undefined;
  if (typeof value === "string" && value !== "") {
    const converted = Number(value);
    return Number.isFinite(converted)
      ? Math.max(0, Math.round(converted))
      : undefined;
  }
  return undefined;
}

function tableType(value: unknown): TableRef["type"] {
  if (typeof value !== "string") return "other";
  const normalized = value.toLowerCase();
  if (normalized === "base table") return "table";
  if (normalized.includes("view")) return "view";
  return "other";
}

export class CatalogCancelledError extends Error {
  constructor() {
    super("Query cancelled");
    this.name = "CatalogCancelledError";
  }
}

/**
 * cancelActive() raises a session flag that exactly one execution has to take
 * back down. executeTimed does that for user queries; a catalog read has to do
 * the same, or a Ctrl-C here leaves the flag standing and the next successful
 * user query is reported as cancelled.
 *
 * Reads only: the caller discards the rows, so a read that raced a cancel is
 * reported as cancelled. A statement that moves the server session cannot be
 * disowned that way — see selectSchema.
 */
async function runCatalogRead<T>(
  session: DatabaseSession,
  run: () => Promise<T>,
): Promise<T> {
  try {
    const value = await run();
    if (session.takeCancellation()) throw new CatalogCancelledError();
    return value;
  } catch (error) {
    if (error instanceof CatalogCancelledError) throw error;
    if (session.takeCancellation()) throw new CatalogCancelledError();
    throw error;
  }
}

export async function listSchemas(
  session: DatabaseSession,
  dialect: Dialect,
  includeSystem = false,
): Promise<SchemaRef[]> {
  const result: unknown = await runCatalogRead(session, () =>
    session.executeCatalog(dialect.listSchemas(includeSystem)),
  );
  return records(result)
    .map((row) => text(field(row, "schema_name")))
    .filter((schema): schema is string => schema !== undefined)
    .map((schema) => ({ schema }));
}

export async function listTables(
  session: DatabaseSession,
  dialect: Dialect,
  schema: string,
): Promise<TableRef[]> {
  const result: unknown = await runCatalogRead(session, () =>
    session.executeCatalog(
      dialect.listTables(schema),
      dialect.tableParameters(schema),
    ),
  );
  return records(result).flatMap((row) => {
    const resultSchema = text(field(row, "schema_name"));
    const table = text(field(row, "table_name"));
    if (!resultSchema || !table) return [];
    const approxRows = approximateRows(field(row, "approx_rows"));
    return [
      {
        schema: resultSchema,
        table,
        type: tableType(field(row, "table_type")),
        ...(approxRows === undefined ? {} : { approxRows }),
      },
    ];
  });
}

export async function listColumns(
  session: DatabaseSession,
  dialect: Dialect,
  schema: string,
): Promise<ColumnRef[]> {
  const result: unknown = await runCatalogRead(session, () =>
    session.executeCatalog(
      dialect.listColumns(schema),
      dialect.columnParameters(schema),
    ),
  );
  return records(result).flatMap((row) => {
    const resultSchema = text(field(row, "schema_name"));
    const table = text(field(row, "table_name"));
    const column = text(field(row, "column_name"));
    return resultSchema && table && column
      ? [{ schema: resultSchema, table, column }]
      : [];
  });
}

/**
 * Cache key for the completion candidates of one schema on one connection.
 * A connection is identified by name, engine and source everywhere else in the
 * app, so the key needs all three: two credential stores can hold an entry of
 * the same name for the same engine without pointing at the same server. The
 * resolved database also determines its schema contents, so re-resolving an
 * entry to a different database needs a separate cache entry. Serialise rather
 * than join because a connection or schema name may contain any separator.
 */
export function completionCacheKey(
  connection: Pick<
    ConnectionSummary,
    "source" | "engine" | "name" | "database"
  >,
  schema: string,
): string {
  return JSON.stringify([
    connection.source,
    connection.engine,
    connection.name,
    connection.database ?? null,
    schema,
  ]);
}

export async function selectSchema(
  session: DatabaseSession,
  dialect: Dialect,
  schema: string,
): Promise<void> {
  try {
    await session.executeCatalog(dialect.selectSchema(schema));
    // This statement moved the server session, so the caller has to record the
    // new schema even if a Ctrl-C raced it to the finish. Take the flag down
    // without turning a switch that already happened into an error, or the
    // Header and unqualified SQL end up pointing at different schemas.
    session.takeCancellation();
  } catch (error) {
    if (session.takeCancellation()) throw new CatalogCancelledError();
    throw error;
  }
}
