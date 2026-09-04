export type Engine = "mysql" | "postgres";

export interface ConnectionRef {
  /** Display name: a MySQL login path or PostgreSQL service name. */
  name: string;
  engine: Engine;
  source: "mylogin" | "pg_service" | "env";
}

export interface ConnectionListItem extends ConnectionRef {
  available: boolean;
  unavailableReason?: string;
}

export interface ResolvedConnection extends ConnectionRef {
  host: string;
  port: number;
  user: string;
  database?: string;
  /** Never store this value in UI state, logs, or errors. */
  password?: string;
}

export type ConnectionSummary = Omit<ResolvedConnection, "password">;

export interface SchemaRef {
  schema: string;
}

export interface TableRef {
  schema: string;
  table: string;
  type: "table" | "view" | "other";
  approxRows?: number;
}

export interface ColumnRef {
  name: string;
  dataType: string;
  nullable: boolean;
  isPrimaryKey: boolean;
  defaultValue?: string;
}

export interface ResultSet {
  columns: string[];
  rows: unknown[][];
  rowCount: number;
  hasMore: boolean;
  elapsedMs: number;
  sql: string;
  offset: number;
  truncated?: boolean;
}

export interface QueryError {
  message: string;
  code?: string;
}

export type Mode = "connections" | "catalog" | "result" | "query" | "help";

export interface HistoryEntry {
  sql: string;
  connection: string;
  executedAt: Date;
  ok: boolean;
}
