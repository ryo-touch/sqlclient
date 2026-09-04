import { describe, expect, test } from "bun:test";

import {
  discoverConnections,
  findPgPassPassword,
  isSecurePgPassMode,
  parseMyPrintDefaults,
  parseMysqlLoginPathNames,
  parsePgPassFile,
  parsePgServiceFile,
  resolveConnection,
} from "../src/core/credentials.ts";
import type { Exec } from "../src/util/exec.ts";

const fixture = (name: string): Promise<string> =>
  Bun.file(new URL(`fixtures/${name}`, import.meta.url)).text();

describe("PostgreSQL service files", () => {
  test("parses sections, comments, whitespace, and values containing equals", async () => {
    expect(parsePgServiceFile(await fixture("pg_service.conf"))).toEqual([
      {
        name: "analytics",
        values: {
          host: "db.example.test",
          port: "5433",
          user: "analyst",
          dbname: "warehouse",
        },
      },
      {
        name: "local",
        values: { host: "localhost", user: "developer=name" },
      },
    ]);
  });
});

describe("PostgreSQL password files", () => {
  test("parses escaped colons and backslashes and skips malformed lines", async () => {
    expect(parsePgPassFile(await fixture("pgpass"))).toEqual([
      {
        host: "db.example.test",
        port: "5433",
        database: "warehouse",
        user: "analyst",
        password: "specific:password",
      },
      {
        host: "*",
        port: "5433",
        database: "*",
        user: "analyst",
        password: "wildcard",
      },
      {
        host: "localhost",
        port: "5432",
        database: "developer",
        user: "developer",
        password: "back\\slash",
      },
    ]);
  });

  test("uses the first matching entry", async () => {
    const entries = parsePgPassFile(await fixture("pgpass"));
    expect(
      findPgPassPassword(entries, {
        host: "db.example.test",
        port: 5433,
        database: "warehouse",
        user: "analyst",
      }),
    ).toBe("specific:password");
    expect(
      findPgPassPassword(entries, {
        host: "other.example.test",
        port: 5433,
        database: "any",
        user: "analyst",
      }),
    ).toBe("wildcard");
  });

  test("accepts modes that deny group and world access", () => {
    expect(isSecurePgPassMode(0o600)).toBeTrue();
    expect(isSecurePgPassMode(0o400)).toBeTrue();
    expect(isSecurePgPassMode(0o640)).toBeFalse();
    expect(isSecurePgPassMode(0o604)).toBeFalse();
  });
});

describe("MySQL login paths", () => {
  test("extracts only login-path section names", () => {
    expect(
      parseMysqlLoginPathNames(`
[client]
user = example
password = *****
[staging]
host = db.example.test
`),
    ).toEqual(["client", "staging"]);
  });

  test("parses values without splitting embedded equals signs", () => {
    expect(
      parseMyPrintDefaults(
        "--user=reader\n--password=value=with=equals\n--host=localhost\n",
      ),
    ).toEqual({
      user: "reader",
      password: "value=with=equals",
      host: "localhost",
    });
  });
});

describe("credential discovery and resolution", () => {
  test("discovers names without resolving MySQL passwords", async () => {
    const calls: string[][] = [];
    const fakeExec: Exec = async (executable, args) => {
      calls.push([executable, ...args]);
      return {
        stdout: "[staging]\nuser = reader\npassword = *****\n",
        stderr: "",
        exitCode: 0,
      };
    };
    const result = await discoverConnections({
      env: {},
      home: "/not-present",
      exec: fakeExec,
      findExecutable: (name) => `/bin/${name}`,
      readText: async () => undefined,
    });

    expect(result.connections).toEqual([
      {
        name: "staging",
        engine: "mysql",
        source: "mylogin",
        available: true,
      },
    ]);
    expect(calls).toEqual([["/bin/mysql_config_editor", "print", "--all"]]);
  });

  test("resolves PostgreSQL service values and ignores an insecure password file", async () => {
    const result = await resolveConnection(
      { name: "analytics", engine: "postgres", source: "pg_service" },
      {
        env: { PGSERVICEFILE: "/service", PGPASSFILE: "/password" },
        operatingSystemUser: "fallback",
        readText: async (path) => {
          if (path === "/service") return fixture("pg_service.conf");
          if (path === "/password") return fixture("pgpass");
          return undefined;
        },
        fileMode: async () => 0o644,
      },
    );

    expect(result.connection).toEqual({
      name: "analytics",
      engine: "postgres",
      source: "pg_service",
      host: "db.example.test",
      port: 5433,
      user: "analyst",
      database: "warehouse",
      password: undefined,
    });
    expect(result.warnings).toHaveLength(1);
  });

  test("never includes command output in a MySQL resolution failure", async () => {
    const result = await resolveConnection(
      { name: "broken", engine: "mysql", source: "mylogin" },
      {
        env: {},
        exec: async () => ({
          stdout: "--password=fixture-secret",
          stderr: "fixture-secret",
          exitCode: 1,
        }),
        findExecutable: () => "/bin/my_print_defaults",
      },
    );
    expect(JSON.stringify(result)).not.toContain("fixture-secret");
  });
});
