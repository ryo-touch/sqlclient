import { describe, expect, test } from "bun:test";

import {
  buildConnectionUrl,
  isLoopbackHost,
  readOnlyValueIsVerified,
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

describe("database connection URLs", () => {
  test("URL-encodes all credential components", () => {
    expect(buildConnectionUrl(connection)).toBe(
      "postgres://read%20only:p%40ss%3A%2Fword@db.example.test:5432/data%2Fname",
    );
  });

  test("recognizes only loopback hosts for local MySQL authentication", () => {
    expect(isLoopbackHost("localhost")).toBeTrue();
    expect(isLoopbackHost("127.0.0.1")).toBeTrue();
    expect(isLoopbackHost("::1")).toBeTrue();
    expect(isLoopbackHost("db.example.test")).toBeFalse();
  });
});

describe("read-only verification", () => {
  test("recognizes MySQL and PostgreSQL confirmation values", () => {
    expect(readOnlyValueIsVerified("mysql", [{ value: 1 }])).toBeTrue();
    expect(readOnlyValueIsVerified("mysql", [{ value: 0 }])).toBeFalse();
    expect(
      readOnlyValueIsVerified("postgres", [
        { default_transaction_read_only: "on" },
      ]),
    ).toBeTrue();
    expect(
      readOnlyValueIsVerified("postgres", [
        { default_transaction_read_only: "off" },
      ]),
    ).toBeFalse();
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
