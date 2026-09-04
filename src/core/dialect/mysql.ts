import { assertValidIdentifier, type Dialect } from "./index.ts";

export function quoteMysqlIdent(name: string): string {
  assertValidIdentifier(name);
  return `\`${name.replaceAll("`", "``")}\``;
}

export const mysqlDialect: Dialect = {
  engine: "mysql",
  quoteIdent: quoteMysqlIdent,
  listSchemas: (includeSystem = false) => `
SELECT schema_name AS schema_name
FROM information_schema.schemata
${
  includeSystem
    ? ""
    : "WHERE schema_name NOT IN ('information_schema', 'performance_schema', 'mysql', 'sys')"
}
ORDER BY schema_name`,
  listTables: () => `
SELECT
  table_schema AS schema_name,
  table_name,
  table_type,
  table_rows AS approx_rows
FROM information_schema.tables
WHERE table_schema = ?
ORDER BY table_name`,
  listColumns: () => `
SELECT
  column_name,
  data_type,
  is_nullable,
  column_key = 'PRI' AS is_primary_key,
  column_default
FROM information_schema.columns
WHERE table_schema = ? AND table_name = ?
ORDER BY ordinal_position`,
  selectSchema: (schema) => `USE ${quoteMysqlIdent(schema)}`,
  selectAll: (schema, table, limit, offset) =>
    `SELECT * FROM ${quoteMysqlIdent(schema)}.${quoteMysqlIdent(table)} LIMIT ${limit} OFFSET ${offset}`,
  tableParameters: (schema) => [schema],
  columnParameters: (schema, table) => [schema, table],
};
