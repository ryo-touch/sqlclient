import type { DatabaseSession } from "./connection.ts";
import type { Dialect } from "./dialect/index.ts";
import type { ColumnRef, SchemaRef, TableRef } from "../types.ts";

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

function booleanValue(value: unknown): boolean {
  return (
    value === true ||
    value === 1 ||
    value === 1n ||
    value === "1" ||
    value === "YES"
  );
}

export async function listSchemas(
  session: DatabaseSession,
  dialect: Dialect,
  includeSystem = false,
): Promise<SchemaRef[]> {
  const result: unknown = await session.executeCatalog(
    dialect.listSchemas(includeSystem),
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
  const result: unknown = await session.executeCatalog(
    dialect.listTables(schema),
    dialect.tableParameters(schema),
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
  table: string,
): Promise<ColumnRef[]> {
  const result: unknown = await session.executeCatalog(
    dialect.listColumns(schema, table),
    dialect.columnParameters(schema, table),
  );
  return records(result).flatMap((row) => {
    const name = text(field(row, "column_name"));
    const dataType = text(field(row, "data_type"));
    if (!name || !dataType) return [];
    const defaultValue = field(row, "column_default");
    return [
      {
        name,
        dataType,
        nullable: booleanValue(field(row, "is_nullable")),
        isPrimaryKey: booleanValue(field(row, "is_primary_key")),
        ...(defaultValue === null || defaultValue === undefined
          ? {}
          : { defaultValue: String(defaultValue) }),
      },
    ];
  });
}
