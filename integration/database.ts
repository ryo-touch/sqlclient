import { strict as assert } from "node:assert";
import { SQL } from "bun";

import {
  listColumns,
  listSchemas,
  listTables,
  selectSchema,
} from "../src/core/catalog.ts";
import { connectDatabase } from "../src/core/connection.ts";
import { dialectFor } from "../src/core/dialect/index.ts";
import { executeTablePage, executeUserQuery } from "../src/core/query.ts";
import type { Engine } from "../src/types.ts";

const database = "sqlclient_integration";
const password = "integration-only";

function testPort(variable: string): number {
  const port = Number(process.env[variable]);
  assert(
    Number.isInteger(port) && port > 0 && port <= 65535,
    `${variable} is required; run bun run test:integration`,
  );
  return port;
}

const ports = {
  mysql: testPort("MYSQL_TEST_PORT"),
  postgres: testPort("POSTGRES_TEST_PORT"),
};

async function verifyDatabase(engine: Engine): Promise<void> {
  const admin = new SQL({
    adapter: engine,
    hostname: "127.0.0.1",
    port: ports[engine],
    username: engine === "mysql" ? "root" : "postgres",
    password,
    database,
    allowPublicKeyRetrieval: engine === "mysql",
  });
  try {
    if (engine === "mysql") {
      await admin.unsafe(
        "create table items (id int primary key, label varchar(30))",
      );
      await admin.unsafe(
        "insert into items with recursive seq as (select 1 n union all select n + 1 from seq where n < 405) select n, concat('row-', n) from seq",
      );
      await admin.unsafe(
        "create user 'reader'@'%' identified by 'integration-only'",
      );
      await admin.unsafe(
        "grant select on sqlclient_integration.* to 'reader'@'%'",
      );
    } else {
      await admin.unsafe(
        "create table items as select n as id, 'row-' || n as label from generate_series(1, 405) n",
      );
      await admin.unsafe(
        "create role reader login password 'integration-only'",
      );
      await admin.unsafe("grant usage on schema public to reader");
      await admin.unsafe("grant select on items to reader");
    }

    const session = await connectDatabase({
      engine,
      name: "integration",
      source: "env",
      host: "127.0.0.1",
      port: ports[engine],
      user: "reader",
      password,
      database,
    });
    try {
      const dialect = dialectFor(engine);
      const schema = engine === "mysql" ? database : "public";
      assert(
        (await listSchemas(session, dialect)).some(
          (item) => item.schema === schema,
        ),
      );
      assert(
        (await listTables(session, dialect, schema)).some(
          (item) => item.table === "items",
        ),
      );
      assert(
        (await listColumns(session, dialect, schema)).some(
          (item) => item.table === "items" && item.column === "id",
        ),
      );
      await selectSchema(session, dialect, schema);
      const selected = await executeUserQuery(
        session,
        "select count(*) as total from items",
      );
      assert(selected.ok);
      assert.equal(Number(selected.result.rows[0]?.[0]), 405);

      for (const [offset, count, hasMore] of [
        [0, 200, true],
        [200, 200, true],
        [400, 5, false],
      ] as const) {
        const page = await executeTablePage(
          session,
          dialect,
          schema,
          "items",
          offset,
        );
        assert(page.ok);
        assert.equal(page.result.rows.length, count);
        assert.equal(page.result.hasMore, hasMore);
      }
      const special = await executeUserQuery(
        session,
        "select null as nullable, 'NULL' as text_value",
      );
      assert(special.ok);
      assert.deepEqual(special.result.rows, [[null, "NULL"]]);
      const truncated = await executeUserQuery(
        session,
        engine === "mysql"
          ? "select a.id from items a cross join items b limit 2005"
          : "select n from generate_series(1, 2005) n",
      );
      assert(truncated.ok);
      assert.equal(truncated.result.rows.length, 2000);
      assert.equal(truncated.result.rowCount, 2005);
      assert.equal(truncated.result.truncated, true);

      const started = performance.now();
      const pending = executeUserQuery(
        session,
        engine === "mysql" ? "select sleep(30)" : "select pg_sleep(30)",
        10_000,
      );
      let running = false;
      for (let attempt = 0; attempt < 50; attempt++) {
        const rows = await admin.unsafe(
          engine === "mysql"
            ? "select count(*) as active from information_schema.processlist where user = 'reader' and info like '%sleep(30)%'"
            : "select count(*) as active from pg_stat_activity where usename = 'reader' and state = 'active' and query like '%pg_sleep(30)%'",
        );
        if (Number(rows[0]?.active) > 0) {
          running = true;
          break;
        }
        await Bun.sleep(100);
      }
      assert(
        running,
        "Sleep query must be running on the database before cancellation",
      );
      assert.equal(await session.cancelActive(), true);
      const cancelled = await pending;
      assert(!cancelled.ok);
      assert.equal(cancelled.error.message, "Query cancelled");
      assert.equal(cancelled.timedOut, false);
      assert(performance.now() - started < 10_000);
      const recovered = await executeUserQuery(session, "select 1 as ok");
      assert(recovered.ok);
      assert.equal(recovered.result.rows[0]?.[0], 1);
      console.log(
        `${engine}: catalog, schema selection, paging, NULL, row cap, cancellation and recovery passed`,
      );
    } finally {
      await session.close();
    }
  } finally {
    await admin.close({ timeout: 0 });
  }
}

for (const engine of ["mysql", "postgres"] as const)
  await verifyDatabase(engine);
