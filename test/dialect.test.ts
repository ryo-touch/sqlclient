import { describe, expect, test } from "bun:test";

import { dialectFor } from "../src/core/dialect/index.ts";
import { quoteMysqlIdent } from "../src/core/dialect/mysql.ts";
import { quotePostgresIdent } from "../src/core/dialect/postgres.ts";

describe("identifier quoting", () => {
  test("quotes MySQL identifiers", () => {
    expect(quoteMysqlIdent("")).toBe("``");
    expect(quoteMysqlIdent("order")).toBe("`order`");
    expect(quoteMysqlIdent("has`tick")).toBe("`has``tick`");
    expect(quoteMysqlIdent("path\\名前")).toBe("`path\\名前`");
  });

  test("quotes PostgreSQL identifiers", () => {
    expect(quotePostgresIdent("")).toBe('""');
    expect(quotePostgresIdent("order")).toBe('"order"');
    expect(quotePostgresIdent('has"quote')).toBe('"has""quote"');
    expect(quotePostgresIdent("path\\名前")).toBe('"path\\名前"');
  });

  test("rejects NUL in either dialect", () => {
    expect(() => quoteMysqlIdent("bad\0name")).toThrow("NUL");
    expect(() => quotePostgresIdent("bad\0name")).toThrow("NUL");
  });
});

describe("dialect queries", () => {
  test("quotes both identifiers in generated table queries", () => {
    expect(dialectFor("mysql").selectAll("odd`db", "table", 201, 0)).toBe(
      "SELECT * FROM `odd``db`.`table` LIMIT 201 OFFSET 0",
    );
    expect(dialectFor("postgres").selectAll('odd"db', "table", 201, 200)).toBe(
      'SELECT * FROM "odd""db"."table" LIMIT 201 OFFSET 200',
    );
  });

  test("quotes the selected default schema", () => {
    expect(dialectFor("mysql").selectSchema("odd`db")).toBe("USE `odd``db`");
    expect(dialectFor("postgres").selectSchema('odd"db')).toBe(
      'SET search_path TO "odd""db"',
    );
  });

  test("uses adapter-specific value placeholders", () => {
    expect(dialectFor("mysql").listTables("ignored")).toContain(
      "table_schema = ?",
    );
    expect(dialectFor("postgres").listTables("ignored")).toContain(
      "tables.table_schema = $1",
    );
    expect(dialectFor("postgres").listColumns("ignored", "ignored")).toContain(
      "columns.table_name = $2",
    );
  });

  test("hides system schemas unless explicitly requested", () => {
    expect(dialectFor("mysql").listSchemas()).toContain("information_schema");
    expect(dialectFor("mysql").listSchemas(true)).not.toContain("NOT IN");
    expect(dialectFor("postgres").listSchemas()).toContain("pg_catalog");
    expect(dialectFor("postgres").listSchemas(true)).not.toContain("NOT LIKE");
  });
});
