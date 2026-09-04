import { describe, expect, test } from "bun:test";

import {
  buildConnectionOptions,
  isLoopbackHost,
  sanitizeDatabaseError,
} from "../src/core/connection.ts";
import type { ResolvedConnection } from "../src/types.ts";

const connection: ResolvedConnection = {
  name: "fixture",
  engine: "postgres",
  source: "pg_service",
  host: "db.example.test",
  port: 5432,
  user: "read only",
  database: "data/name",
  password: "p@ss:/word",
};

describe("database connection options", () => {
  test("passes connection fields without serializing credentials into a URL", () => {
    expect(buildConnectionOptions(connection)).toMatchObject({
      adapter: "postgres",
      hostname: "db.example.test",
      port: 5432,
      username: "read only",
      database: "data/name",
      password: "p@ss:/word",
    });
  });

  test("preserves IPv6 literals as hostnames", () => {
    expect(
      buildConnectionOptions({ ...connection, host: "2001:db8::1" }),
    ).toMatchObject({ hostname: "2001:db8::1" });
    expect(
      buildConnectionOptions({ ...connection, host: "[::1]" }),
    ).toMatchObject({ hostname: "::1" });
  });

  test("recognizes only loopback hosts for local MySQL authentication", () => {
    expect(isLoopbackHost("localhost")).toBeTrue();
    expect(isLoopbackHost("127.0.0.1")).toBeTrue();
    expect(isLoopbackHost("::1")).toBeTrue();
    expect(isLoopbackHost("[::1]")).toBeTrue();
    expect(isLoopbackHost("2001:db8::1")).toBeFalse();
    expect(isLoopbackHost("db.example.test")).toBeFalse();
    expect(
      buildConnectionOptions({ ...connection, engine: "mysql", host: "::1" }),
    ).toMatchObject({ allowPublicKeyRetrieval: true });
    expect(
      buildConnectionOptions({
        ...connection,
        engine: "mysql",
        host: "2001:db8::1",
      }),
    ).toMatchObject({ allowPublicKeyRetrieval: false });
  });
});

describe("database error sanitization", () => {
  test("removes raw and encoded passwords and URL credentials", () => {
    const error = new Error(
      `failed ${connection.password} ${encodeURIComponent(connection.password ?? "")} ` +
        "postgres://someone:another-secret@db.example.test/database password=visible",
    );
    const sanitized = sanitizeDatabaseError(error, connection);
    expect(sanitized.message).not.toContain(connection.password);
    expect(sanitized.message).not.toContain("another-secret");
    expect(sanitized.message).not.toContain("visible");
    expect(sanitized.message).toContain("[redacted]");
  });

  test("keeps a string error code without copying other fields", () => {
    const sanitized = sanitizeDatabaseError({
      message: "not trusted because it is not an Error",
      code: "TEST_CODE",
      password: "do-not-copy",
    });
    expect(sanitized).toEqual({
      message: "Database operation failed",
      code: "TEST_CODE",
    });
    expect(JSON.stringify(sanitized)).not.toContain("do-not-copy");
  });
});
