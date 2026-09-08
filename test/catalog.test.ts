import { describe, expect, test } from "bun:test";

import {
  CatalogCancelledError,
  completionCacheKey,
  listColumns,
  listTables,
  selectSchema,
} from "../src/core/catalog.ts";
import type { DatabaseSession } from "../src/core/connection.ts";
import { mysqlDialect } from "../src/core/dialect/mysql.ts";
import type { ConnectionSummary } from "../src/types.ts";

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

  test("normalizes column metadata", async () => {
    const columns = await listColumns(
      sessionReturning([
        { SCHEMA_NAME: "app", table_name: "items", COLUMN_NAME: "item_id" },
      ]),
      mysqlDialect,
      "app",
    );
    expect(columns).toEqual([
      { schema: "app", table: "items", column: "item_id" },
    ]);
  });
});

describe("completion cache key", () => {
  const base = {
    name: "staging",
    engine: "postgres" as const,
    source: "pg_service" as const,
    host: "db.example.test",
    port: 5432,
    user: "reader",
    database: "warehouse",
  };

  test("separates connections that only differ by store", () => {
    // A login path and a pg_service entry may share a name and an engine and
    // still be different servers, which is why connection identity is
    // name + engine + source everywhere else in the app.
    expect(completionCacheKey({ ...base, source: "env" }, "app")).not.toBe(
      completionCacheKey(base, "app"),
    );
    const differentEngine: ConnectionSummary = {
      ...base,
      engine: "mysql",
      port: 3306,
    };
    expect(completionCacheKey(differentEngine, "app")).not.toBe(
      completionCacheKey(base, "app"),
    );
    expect(completionCacheKey({ ...base, name: "other" }, "app")).not.toBe(
      completionCacheKey(base, "app"),
    );
    expect(completionCacheKey(base, "other")).not.toBe(
      completionCacheKey(base, "app"),
    );
  });

  test("ignores fields that do not determine schema contents", () => {
    const differentTransport: ConnectionSummary = {
      ...base,
      host: "10.0.0.1",
      port: 6543,
      user: "other",
    };
    expect(completionCacheKey(differentTransport, "app")).toBe(
      completionCacheKey(base, "app"),
    );
  });

  test("separates databases resolved from the same connection entry", () => {
    expect(
      completionCacheKey({ ...base, database: "reporting" }, "app"),
    ).not.toBe(completionCacheKey(base, "app"));
  });

  test("keeps names apart when they contain separator characters", () => {
    expect(completionCacheKey({ ...base, name: "a:b" }, "c")).not.toBe(
      completionCacheKey({ ...base, name: "a" }, "b:c"),
    );
  });
});

describe("catalog cancellation", () => {
  // Ctrl-C during a catalog read: the flag is raised while the query is in
  // flight, and the query may then reject or still come back normally.
  function cancelledSession(reject: boolean): DatabaseSession {
    let cancellationRequested = false;
    return {
      ...sessionReturning([]),
      executeCatalog: () => {
        cancellationRequested = true;
        return (
          reject
            ? Promise.reject(new Error("Query execution was interrupted"))
            : Promise.resolve([])
        ) as never;
      },
      takeCancellation: () => {
        const requested = cancellationRequested;
        cancellationRequested = false;
        return requested;
      },
    };
  }

  test("reports a cancelled catalog read as cancelled", async () => {
    for (const reject of [true, false]) {
      await expect(
        listColumns(cancelledSession(reject), mysqlDialect, "app"),
      ).rejects.toThrow(CatalogCancelledError);
    }
  });

  test("a cancelled catalog read does not taint the next query", async () => {
    for (const reject of [true, false]) {
      const session = cancelledSession(reject);
      await listColumns(session, mysqlDialect, "app").catch(() => undefined);
      // Left standing, executeTimed picks this up and discards a good result.
      expect(session.takeCancellation()).toBe(false);
    }
  });

  test("a schema switch that completed is not reported as cancelled", async () => {
    // USE app already moved the server session; throwing here would leave the
    // caller from dispatching schemaSelected and desync the Header.
    const session = cancelledSession(false);
    await selectSchema(session, mysqlDialect, "app");
    expect(session.takeCancellation()).toBe(false);
  });

  test("a schema switch that failed under cancel is reported as cancelled", async () => {
    const session = cancelledSession(true);
    await expect(selectSchema(session, mysqlDialect, "app")).rejects.toThrow(
      CatalogCancelledError,
    );
    expect(session.takeCancellation()).toBe(false);
  });

  test("an uncancelled catalog read still surfaces the server error", async () => {
    const session: DatabaseSession = {
      ...sessionReturning([]),
      executeCatalog: () =>
        Promise.reject(new Error("relation does not exist")) as never,
    };
    await expect(listColumns(session, mysqlDialect, "app")).rejects.toThrow(
      "relation does not exist",
    );
  });
});
