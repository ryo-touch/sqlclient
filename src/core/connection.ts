import { SQL } from "bun";

import type {
  ConnectionSummary,
  QueryError,
  ResolvedConnection,
} from "../types.ts";

type Query<T> = SQL.Query<T>;
type ConnectionId = number;

export interface DatabaseSession {
  readonly info: ConnectionSummary;
  readonly readOnlyVerified: true;
  executeCatalog<T>(statement: string, values?: readonly unknown[]): Query<T>;
  executeUser<T>(statement: string): Query<T>;
  toQueryError(error: unknown): QueryError;
  cancelActive(): Promise<boolean>;
  takeCancellation(): boolean;
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

const mysqlReadOnlyPrivileges = new Set([
  "PROCESS",
  "REPLICATION CLIENT",
  "SELECT",
  "SHOW DATABASES",
  "SHOW VIEW",
  "USAGE",
]);

export function mysqlGrantsAreReadOnly(rows: unknown): boolean {
  if (!Array.isArray(rows) || rows.length === 0) return false;
  const privileges: string[] = [];

  for (const row of rows) {
    if (typeof row !== "object" || row === null) return false;
    const grant = Object.values(row).find(
      (value): value is string => typeof value === "string",
    );
    if (!grant || /\bWITH\s+GRANT\s+OPTION\b/iu.test(grant)) return false;
    const match = /^GRANT\s+(.+?)\s+ON\s+.+?\s+TO\s+/iu.exec(grant);
    if (!match?.[1]) return false;
    privileges.push(
      ...match[1].split(",").map((privilege) => privilege.trim().toUpperCase()),
    );
  }

  return (
    privileges.includes("SELECT") &&
    privileges.every((privilege) => mysqlReadOnlyPrivileges.has(privilege))
  );
}

function connectionId(rows: unknown): ConnectionId | undefined {
  if (!Array.isArray(rows) || rows.length === 0) return undefined;
  const row = rows[0];
  if (typeof row !== "object" || row === null) return undefined;
  const value = Object.values(row)[0];
  const numeric = typeof value === "bigint" ? Number(value) : value;
  return typeof numeric === "number" &&
    Number.isSafeInteger(numeric) &&
    numeric > 0
    ? numeric
    : undefined;
}

export async function connectDatabase(
  connection: ResolvedConnection,
): Promise<DatabaseSession> {
  const options: Bun.SQL.Options = {
    url: buildConnectionUrl(connection),
    max: 1,
    idleTimeout: 0,
    maxLifetime: 0,
    connectionTimeout: 30,
    // Public-key retrieval without TLS is acceptable only for a local disposable server.
    allowPublicKeyRetrieval:
      connection.engine === "mysql" && isLoopbackHost(connection.host),
  };
  const pool = new SQL(options);

  let reserved: Bun.ReservedSQL | undefined;
  let backendId: ConnectionId | undefined;
  try {
    reserved = await pool.reserve({ signal: AbortSignal.timeout(30_000) });
    if (connection.engine === "mysql") {
      await reserved`SET SESSION TRANSACTION READ ONLY`;
      await reserved`SET SESSION max_execution_time = 30000`;
    } else {
      await reserved`SET default_transaction_read_only = on`;
      await reserved`SET statement_timeout = '30s'`;
    }
    const verification =
      connection.engine === "mysql"
        ? await reserved`SELECT @@transaction_read_only`
        : await reserved`SHOW default_transaction_read_only`;
    let readOnlyVerified = readOnlyValueIsVerified(
      connection.engine,
      verification,
    );
    if (!readOnlyVerified && connection.engine === "mysql") {
      // Some Aurora accounts enforce read-only through grants while ignoring the
      // session variable. Accept only an explicit, fully understood read-only set.
      const grants = await reserved`SHOW GRANTS FOR CURRENT_USER()`;
      readOnlyVerified = mysqlGrantsAreReadOnly(grants);
    }
    if (!readOnlyVerified) {
      throw new Error("The server did not confirm read-only mode");
    }
    const identifier =
      connection.engine === "mysql"
        ? await reserved`SELECT CONNECTION_ID() AS connection_id`
        : await reserved`SELECT pg_backend_pid() AS connection_id`;
    backendId = connectionId(identifier);
    if (backendId === undefined) {
      throw new Error("The server did not provide a cancellable connection ID");
    }
  } catch (error) {
    reserved?.release();
    await pool.close({ timeout: 0 }).catch(() => undefined);
    throw new DatabaseConnectionError(sanitizeDatabaseError(error, connection));
  }

  const client = reserved;
  let active: Query<unknown> | undefined;
  let closed = false;
  let cancellationRequested = false;

  const cancelBackend = async (): Promise<boolean> => {
    if (backendId === undefined || !active) return false;
    const control = new SQL(options);
    try {
      if (connection.engine === "mysql") {
        // backendId is a server-provided, validated positive integer.
        await control.unsafe(`KILL QUERY ${backendId}`);
      } else {
        await control`SELECT pg_cancel_backend(${backendId})`;
      }
      return true;
    } catch {
      return false;
    } finally {
      await control.close({ timeout: 0 }).catch(() => undefined);
    }
  };

  const track = <T>(query: Query<T>): Query<T> => {
    const executing = query.execute();
    active = executing as Query<unknown>;
    void executing.then(
      () => {
        if (active === executing) active = undefined;
      },
      () => {
        if (active === executing) active = undefined;
      },
    );
    return executing;
  };

  return {
    info: summary(connection),
    readOnlyVerified: true,
    // Catalog SQL contains only identifiers processed by quoteIdent; values stay bound.
    executeCatalog: <T>(statement: string, values: readonly unknown[] = []) =>
      track(client.unsafe<T>(statement, [...values])),
    // User-authored SQL cannot be parameterized or safely rewritten.
    executeUser: <T>(statement: string) => track(client.unsafe<T>(statement)),
    toQueryError: (error: unknown) => sanitizeDatabaseError(error, connection),
    cancelActive: async () => {
      // Bun 1.4.0 may leave Query.active false while the server is executing it.
      if (!active) return false;
      cancellationRequested = true;
      active.cancel();
      return cancelBackend();
    },
    takeCancellation: () => {
      const requested = cancellationRequested;
      cancellationRequested = false;
      return requested;
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
