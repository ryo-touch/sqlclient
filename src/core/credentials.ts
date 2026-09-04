import { homedir, userInfo } from "node:os";
import { stat } from "node:fs/promises";

import type {
  ConnectionListItem,
  ConnectionRef,
  ResolvedConnection,
} from "../types.ts";
import {
  exec as defaultExec,
  findExecutable as defaultFindExecutable,
  type Exec,
} from "../util/exec.ts";

const MYSQL_BIN = "/opt/homebrew/opt/mysql-client@8.4/bin";

export interface PgService {
  name: string;
  values: Readonly<Record<string, string>>;
}

export interface PgPassEntry {
  host: string;
  port: string;
  database: string;
  user: string;
  password: string;
}

export interface CredentialDiscovery {
  connections: ConnectionListItem[];
  warnings: string[];
}

export interface CredentialResolution {
  connection?: ResolvedConnection;
  warnings: string[];
  error?: string;
}

interface CredentialDependencies {
  env: Readonly<Record<string, string | undefined>>;
  home: string;
  operatingSystemUser: string;
  exec: Exec;
  findExecutable: (
    name: string,
    fallbacks?: readonly string[],
  ) => string | undefined;
  readText: (path: string) => Promise<string | undefined>;
  fileMode: (path: string) => Promise<number | undefined>;
}

export type CredentialOptions = Partial<CredentialDependencies>;

async function defaultReadText(path: string): Promise<string | undefined> {
  const file = Bun.file(path);
  if (!(await file.exists())) return undefined;
  return file.text();
}

async function defaultFileMode(path: string): Promise<number | undefined> {
  try {
    return (await stat(path)).mode & 0o777;
  } catch {
    return undefined;
  }
}

function dependencies(options: CredentialOptions): CredentialDependencies {
  return {
    env: options.env ?? Bun.env,
    home: options.home ?? homedir(),
    operatingSystemUser: options.operatingSystemUser ?? userInfo().username,
    exec: options.exec ?? defaultExec,
    findExecutable: options.findExecutable ?? defaultFindExecutable,
    readText: options.readText ?? defaultReadText,
    fileMode: options.fileMode ?? defaultFileMode,
  };
}

export function parsePgServiceFile(content: string): PgService[] {
  const services: Array<{ name: string; values: Record<string, string> }> = [];
  let current: { name: string; values: Record<string, string> } | undefined;

  for (const rawLine of content.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#") || line.startsWith(";")) continue;

    const section = /^\[(.+)\]$/u.exec(line);
    if (section?.[1]) {
      current = { name: section[1].trim(), values: {} };
      if (current.name !== "") services.push(current);
      continue;
    }

    if (!current) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    current.values[key] = value;
  }

  return services;
}

function splitPgPassLine(line: string): string[] | undefined {
  const fields: string[] = [];
  let field = "";
  let escaped = false;

  for (const character of line) {
    if (escaped) {
      if (character === ":" || character === "\\") {
        field += character;
      } else {
        field += `\\${character}`;
      }
      escaped = false;
    } else if (character === "\\") {
      escaped = true;
    } else if (character === ":") {
      fields.push(field);
      field = "";
    } else {
      field += character;
    }
  }

  if (escaped) field += "\\";
  fields.push(field);
  return fields.length === 5 ? fields : undefined;
}

export function parsePgPassFile(content: string): PgPassEntry[] {
  const entries: PgPassEntry[] = [];

  for (const rawLine of content.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    const fields = splitPgPassLine(line);
    if (!fields) continue;
    const [host, port, database, user, password] = fields;
    if (
      host === undefined ||
      port === undefined ||
      database === undefined ||
      user === undefined ||
      password === undefined
    ) {
      continue;
    }
    entries.push({ host, port, database, user, password });
  }

  return entries;
}

export function findPgPassPassword(
  entries: readonly PgPassEntry[],
  connection: Pick<ResolvedConnection, "host" | "port" | "user" | "database">,
): string | undefined {
  const database = connection.database ?? connection.user;
  const matches = (pattern: string, value: string): boolean =>
    pattern === "*" || pattern === value;

  return entries.find(
    (entry) =>
      matches(entry.host, connection.host) &&
      matches(entry.port, String(connection.port)) &&
      matches(entry.database, database) &&
      matches(entry.user, connection.user),
  )?.password;
}

export function isSecurePgPassMode(mode: number): boolean {
  return (mode & 0o077) === 0;
}

export function parseMysqlLoginPathNames(content: string): string[] {
  return content
    .split(/\r?\n/u)
    .map((line) => /^\[(.+)\]$/u.exec(line.trim())?.[1])
    .filter((name): name is string => Boolean(name));
}

export function parseMyPrintDefaults(
  content: string,
): Readonly<Record<string, string>> {
  const values: Record<string, string> = {};
  for (const line of content.split(/\r?\n/u)) {
    if (!line.startsWith("--")) continue;
    const separator = line.indexOf("=");
    if (separator < 3) continue;
    values[line.slice(2, separator)] = line.slice(separator + 1);
  }
  return values;
}

function unavailableMysql(reason: string): ConnectionListItem {
  return {
    name: "MySQL unavailable",
    engine: "mysql",
    source: "mylogin",
    available: false,
    unavailableReason: reason,
  };
}

function mysqlExecutables(deps: CredentialDependencies): {
  defaults?: string;
  editor?: string;
} {
  return {
    defaults: deps.findExecutable("my_print_defaults", [
      `${MYSQL_BIN}/my_print_defaults`,
    ]),
    editor: deps.findExecutable("mysql_config_editor", [
      `${MYSQL_BIN}/mysql_config_editor`,
    ]),
  };
}

async function discoverMysql(
  deps: CredentialDependencies,
): Promise<CredentialDiscovery> {
  const executables = mysqlExecutables(deps);
  if (!executables.defaults) {
    return {
      connections: [unavailableMysql("my_print_defaults was not found")],
      warnings: [],
    };
  }
  if (!executables.editor) {
    return {
      connections: [unavailableMysql("mysql_config_editor was not found")],
      warnings: [],
    };
  }

  try {
    const result = await deps.exec(executables.editor, ["print", "--all"], {
      env: deps.env,
    });
    if (result.exitCode !== 0) {
      return {
        connections: [
          unavailableMysql("the MySQL login-path store could not be read"),
        ],
        warnings: [],
      };
    }
    return {
      connections: parseMysqlLoginPathNames(result.stdout).map((name) => ({
        name,
        engine: "mysql" as const,
        source: "mylogin" as const,
        available: true,
      })),
      warnings: [],
    };
  } catch {
    return {
      connections: [
        unavailableMysql("the MySQL login-path store could not be read"),
      ],
      warnings: [],
    };
  }
}

function pgServicePath(deps: CredentialDependencies): string {
  return deps.env["PGSERVICEFILE"] ?? `${deps.home}/.pg_service.conf`;
}

function pgPassPath(deps: CredentialDependencies): string {
  return deps.env["PGPASSFILE"] ?? `${deps.home}/.pgpass`;
}

function resolvedPostgresValues(
  name: string,
  source: "pg_service" | "env",
  values: Readonly<Record<string, string>>,
  deps: CredentialDependencies,
): Omit<ResolvedConnection, "password"> | undefined {
  const user = values["user"] ?? deps.env["PGUSER"] ?? deps.operatingSystemUser;
  const host = values["host"] ?? deps.env["PGHOST"] ?? "localhost";
  const rawPort = values["port"] ?? deps.env["PGPORT"] ?? "5432";
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return undefined;
  const database = values["dbname"] ?? deps.env["PGDATABASE"] ?? user;

  return { name, engine: "postgres", source, host, port, user, database };
}

async function discoverPostgres(
  deps: CredentialDependencies,
): Promise<CredentialDiscovery> {
  const warnings: string[] = [];
  let serviceContent: string | undefined;
  try {
    serviceContent = await deps.readText(pgServicePath(deps));
  } catch {
    warnings.push("The PostgreSQL service file could not be read");
  }

  if (serviceContent !== undefined) {
    const services = parsePgServiceFile(serviceContent);
    return {
      connections: services.map((service) => {
        const resolved = resolvedPostgresValues(
          service.name,
          "pg_service",
          service.values,
          deps,
        );
        return resolved
          ? { ...resolved, available: true }
          : {
              name: service.name,
              engine: "postgres" as const,
              source: "pg_service" as const,
              available: false,
              unavailableReason: "the port is invalid",
            };
      }),
      warnings,
    };
  }

  const hasEnvironmentConnection = [
    "PGHOST",
    "PGPORT",
    "PGUSER",
    "PGDATABASE",
  ].some((key) => deps.env[key] !== undefined);
  if (!hasEnvironmentConnection) return { connections: [], warnings };

  const resolved = resolvedPostgresValues("environment", "env", {}, deps);
  return {
    connections: resolved
      ? [{ ...resolved, available: true }]
      : [
          {
            name: "environment",
            engine: "postgres",
            source: "env",
            available: false,
            unavailableReason: "PGPORT is invalid",
          },
        ],
    warnings,
  };
}

export async function discoverConnections(
  options: CredentialOptions = {},
): Promise<CredentialDiscovery> {
  const deps = dependencies(options);
  const [mysql, postgres] = await Promise.all([
    discoverMysql(deps),
    discoverPostgres(deps),
  ]);
  return {
    connections: [...mysql.connections, ...postgres.connections],
    warnings: [...mysql.warnings, ...postgres.warnings],
  };
}

async function resolveMysql(
  reference: ConnectionRef,
  deps: CredentialDependencies,
): Promise<CredentialResolution> {
  const executable = mysqlExecutables(deps).defaults;
  if (!executable) {
    return { warnings: [], error: "my_print_defaults was not found" };
  }

  try {
    const result = await deps.exec(executable, ["-s", reference.name], {
      env: deps.env,
    });
    if (result.exitCode !== 0) {
      return {
        warnings: [],
        error: "The selected MySQL login path could not be resolved",
      };
    }
    const values = parseMyPrintDefaults(result.stdout);
    const host = values["host"];
    const user = values["user"];
    const port = Number(values["port"] ?? "3306");
    if (!host || !user || !Number.isInteger(port) || port < 1 || port > 65535) {
      return {
        warnings: [],
        error: "The selected MySQL login path is incomplete",
      };
    }
    return {
      warnings: [],
      connection: {
        ...reference,
        host,
        port,
        user,
        database: values["database"],
        password: values["password"],
      },
    };
  } catch {
    return {
      warnings: [],
      error: "The selected MySQL login path could not be resolved",
    };
  }
}

async function pgPassword(
  connection: Omit<ResolvedConnection, "password">,
  deps: CredentialDependencies,
): Promise<{ password?: string; warnings: string[] }> {
  const path = pgPassPath(deps);
  const [content, mode] = await Promise.all([
    deps.readText(path).catch(() => undefined),
    deps.fileMode(path),
  ]);
  if (content === undefined) return { warnings: [] };
  if (mode === undefined || !isSecurePgPassMode(mode)) {
    return {
      warnings: [
        "The PostgreSQL password file was ignored because its permissions are not private",
      ],
    };
  }
  return {
    password: findPgPassPassword(parsePgPassFile(content), connection),
    warnings: [],
  };
}

async function resolvePostgres(
  reference: ConnectionRef,
  deps: CredentialDependencies,
): Promise<CredentialResolution> {
  let values: Readonly<Record<string, string>> = {};
  if (reference.source === "pg_service") {
    const content = await deps
      .readText(pgServicePath(deps))
      .catch(() => undefined);
    const service = content
      ? parsePgServiceFile(content).find((item) => item.name === reference.name)
      : undefined;
    if (!service) {
      return {
        warnings: [],
        error: "The selected PostgreSQL service could not be resolved",
      };
    }
    values = service.values;
  }

  const base = resolvedPostgresValues(
    reference.name,
    reference.source === "env" ? "env" : "pg_service",
    values,
    deps,
  );
  if (!base) {
    return {
      warnings: [],
      error: "The selected PostgreSQL connection has an invalid port",
    };
  }
  const password = await pgPassword(base, deps);
  return {
    warnings: password.warnings,
    connection: { ...base, password: password.password },
  };
}

export async function resolveConnection(
  reference: ConnectionRef,
  options: CredentialOptions = {},
): Promise<CredentialResolution> {
  const deps = dependencies(options);
  return reference.engine === "mysql"
    ? resolveMysql(reference, deps)
    : resolvePostgres(reference, deps);
}
