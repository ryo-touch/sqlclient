import { describe, expect, test } from "bun:test";

import { listTables } from "../src/core/catalog.ts";
import type { DatabaseSession } from "../src/core/connection.ts";
import { mysqlDialect } from "../src/core/dialect/mysql.ts";

function sessionReturning(rows: unknown): DatabaseSession {
  return {
    info: {
      name: "fixture",
      engine: "mysql",
      source: "mylogin",
      host: "localhost",
      port: 3306,
      user: "reader",
    },
    executeCatalog: () => Promise.resolve(rows) as never,
    executeUser: () => Promise.resolve([]) as never,
    toQueryError: () => ({ message: "failed" }),
    cancelActive: async () => false,
    takeCancellation: () => false,
    close: async () => undefined,
  };
}

describe("catalog normalization", () => {
  test("accepts MySQL information_schema field casing", async () => {
    const tables = await listTables(
      sessionReturning([
        {
          schema_name: "app",
          TABLE_NAME: "items",
          TABLE_TYPE: "BASE TABLE",
          approx_rows: 12,
        },
      ]),
      mysqlDialect,
      "app",
    );
    expect(tables).toEqual([
      {
        schema: "app",
        table: "items",
        type: "table",
        approxRows: 12,
      },
    ]);
  });
});
