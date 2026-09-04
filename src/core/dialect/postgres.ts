import { assertValidIdentifier, type Dialect } from "./index.ts";

export function quotePostgresIdent(name: string): string {
  assertValidIdentifier(name);
  return `"${name.replaceAll('"', '""')}"`;
}

export const postgresDialect: Dialect = {
  engine: "postgres",
  quoteIdent: quotePostgresIdent,
  listSchemas: (includeSystem = false) => `
SELECT schema_name AS schema_name
FROM information_schema.schemata
${
  includeSystem
    ? ""
    : "WHERE schema_name <> 'information_schema' AND schema_name <> 'pg_catalog' AND schema_name NOT LIKE 'pg\\_%' ESCAPE '\\'"
}
ORDER BY schema_name`,
  listTables: () => `
SELECT
  tables.table_schema AS schema_name,
  tables.table_name,
  tables.table_type,
  classes.reltuples AS approx_rows
FROM information_schema.tables AS tables
LEFT JOIN pg_catalog.pg_namespace AS namespaces
  ON namespaces.nspname = tables.table_schema
LEFT JOIN pg_catalog.pg_class AS classes
  ON classes.relnamespace = namespaces.oid
  AND classes.relname = tables.table_name
WHERE tables.table_schema = $1
ORDER BY tables.table_name`,
  listColumns: () => `
SELECT
  columns.column_name,
  columns.data_type,
  columns.is_nullable,
  EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS classes
    JOIN pg_catalog.pg_namespace AS namespaces
      ON namespaces.oid = classes.relnamespace
    JOIN pg_catalog.pg_index AS indexes
      ON indexes.indrelid = classes.oid AND indexes.indisprimary
    JOIN pg_catalog.pg_attribute AS attributes
      ON attributes.attrelid = classes.oid
      AND attributes.attnum = ANY(indexes.indkey)
    WHERE namespaces.nspname = columns.table_schema
      AND classes.relname = columns.table_name
      AND attributes.attname = columns.column_name
  ) AS is_primary_key,
  columns.column_default
FROM information_schema.columns AS columns
WHERE columns.table_schema = $1 AND columns.table_name = $2
ORDER BY columns.ordinal_position`,
  selectSchema: (schema) => `SET search_path TO ${quotePostgresIdent(schema)}`,
  selectAll: (schema, table, limit, offset) =>
    `SELECT * FROM ${quotePostgresIdent(schema)}.${quotePostgresIdent(table)} LIMIT ${limit} OFFSET ${offset}`,
  tableParameters: (schema) => [schema],
  columnParameters: (schema, table) => [schema, table],
};
