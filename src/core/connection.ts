import { SQL } from "bun";

import type {
  ConnectionSummary,
  QueryError,
  ResolvedConnection,
} from "../types.ts";

type Query<T> = SQL.Query<T>;

export interface DatabaseSession {
  readonly info: ConnectionSummary;
  readonly readOnlyVerified: true;
  executeCatalog<T>(statement: string, values?: readonly unknown[]): Query<T>;
  executeUser<T>(statement: string): Query<T>;
  cancelActive(): boolean;
  close(): Promise<void>;
}

export class DatabaseConnectionError extends Error {
  readonly queryError: QueryError;

  constructor(queryError: QueryError) {
    super(queryError.message);
    this.name = "DatabaseConnectionError";
    this.queryError = queryError;
  }
}

function summary(connection: ResolvedConnection): ConnectionSummary {
  return {
    name: connection.name,
    engine: connection.engine,
    source: connection.source,
    host: connection.host,
    port: connection.port,
    user: connection.user,
    database: connection.database,
  };
}

export function buildConnectionUrl(connection: ResolvedConnection): string {
  const url = new URL(`${connection.engine}://localhost`);
  url.hostname = connection.host;
  url.port = String(connection.port);
  url.username = connection.user;
  if (connection.password !== undefined) url.password = connection.password;
  if (connection.database !== undefined) {
    url.pathname = `/${encodeURIComponent(connection.database)}`;
  }
  return url.toString();
}

export function isLoopbackHost(host: string): boolean {
  const normalized = host.toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1"
  );
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }
  return typeof error.code === "string" ? error.code : undefined;
}

export function sanitizeDatabaseError(
  error: unknown,
  connection?: ResolvedConnection,
): QueryError {
  let message =
    error instanceof Error ? error.message : "Database operation failed";
  const secrets = connection?.password
    ? [connection.password, encodeURIComponent(connection.password)]
    : [];
  for (const secret of secrets) {
    if (secret !== "") message = message.replaceAll(secret, "[redacted]");
  }
  message = message
    .replace(/:\/\/[^\s/@]+:[^\s/@]*@/gu, "://[redacted]@")
    .replace(/password\s*=\s*[^\s;]+/giu, "password=[redacted]");
  return { message, code: errorCode(error) };
}

export function readOnlyValueIsVerified(
  engine: ResolvedConnection["engine"],
  rows: unknown,
): boolean {
  if (!Array.isArray(rows) || rows.length === 0) return false;
  const row = rows[0];
  if (typeof row !== "object" || row === null) return false;
  const value = Object.values(row)[0];
  return engine === "mysql" ? value === 1 || value === 1n : value === "on";
}

export async function connectDatabase(
  connection: ResolvedConnection,
): Promise<DatabaseSession> {
  const pool = new SQL({
    url: buildConnectionUrl(connection),
    max: 1,
    idleTimeout: 0,
    maxLifetime: 0,
    connectionTimeout: 30,
    // Public-key retrieval without TLS is acceptable only for a local disposable server.
    allowPublicKeyRetrieval:
      connection.engine === "mysql" && isLoopbackHost(connection.host),
  });

  let reserved: Bun.ReservedSQL | undefined;
  try {
    reserved = await pool.reserve({ signal: AbortSignal.timeout(30_000) });
    if (connection.engine === "mysql") {
      await reserved`SET SESSION TRANSACTION READ ONLY`;
    } else {
      await reserved`SET default_transaction_read_only = on`;
    }
    const verification =
      connection.engine === "mysql"
        ? await reserved`SELECT @@transaction_read_only`
        : await reserved`SHOW default_transaction_read_only`;
    if (!readOnlyValueIsVerified(connection.engine, verification)) {
      throw new Error("The server did not confirm read-only mode");
    }
  } catch (error) {
    reserved?.release();
    await pool.close({ timeout: 0 }).catch(() => undefined);
    throw new DatabaseConnectionError(sanitizeDatabaseError(error, connection));
  }

  const client = reserved;
  let active: Query<unknown> | undefined;
  let closed = false;

  const track = <T>(query: Query<T>): Query<T> => {
    active = query as Query<unknown>;
    void query.then(
      () => {
        if (active === query) active = undefined;
      },
      () => {
        if (active === query) active = undefined;
      },
    );
    return query;
  };

  return {
    info: summary(connection),
    readOnlyVerified: true,
    // Catalog SQL contains only identifiers processed by quoteIdent; values stay bound.
    executeCatalog: <T>(statement: string, values: readonly unknown[] = []) =>
      track(client.unsafe<T>(statement, [...values])),
    // User-authored SQL cannot be parameterized or safely rewritten.
    executeUser: <T>(statement: string) => track(client.unsafe<T>(statement)),
    cancelActive: () => {
      if (!active?.active) return false;
      active.cancel();
      return true;
    },
    close: async () => {
      if (closed) return;
      closed = true;
      active?.cancel();
      client.release();
      await pool.close({ timeout: 0 });
    },
  };
}
