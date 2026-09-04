import type { Engine } from "../../types.ts";
import { mysqlDialect } from "./mysql.ts";
import { postgresDialect } from "./postgres.ts";

export interface Dialect {
  engine: Engine;
  quoteIdent(name: string): string;
  listSchemas(includeSystem?: boolean): string;
  listTables(schema: string): string;
  listColumns(schema: string, table: string): string;
  selectSchema(schema: string): string;
  selectAll(
    schema: string,
    table: string,
    limit: number,
    offset: number,
  ): string;
  tableParameters(schema: string): readonly unknown[];
  columnParameters(schema: string, table: string): readonly unknown[];
}

export function dialectFor(engine: Engine): Dialect {
  return engine === "mysql" ? mysqlDialect : postgresDialect;
}

export function assertValidIdentifier(name: string): void {
  if (name.includes("\0")) {
    throw new Error("Identifiers containing NUL are not supported");
  }
}
