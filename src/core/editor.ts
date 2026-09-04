import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  exec as defaultExec,
  findExecutable as defaultFindExecutable,
  type Exec,
} from "../util/exec.ts";

export interface EditResult {
  sql?: string;
  changed: boolean;
}

interface EditorDependencies {
  env: Readonly<Record<string, string | undefined>>;
  exec: Exec;
  findExecutable: (name: string) => string | undefined;
  temporaryRoot: string;
  pollIntervalMs: number;
}

export type EditorOptions = Partial<EditorDependencies>;

export interface CmuxEditorOptions extends EditorOptions {
  surfaceRef?: string;
  signal?: AbortSignal;
  focus?: boolean;
}

export interface CmuxEditorResult {
  surfaceRef: string;
}

export function parseEditorCommand(command: string): string[] {
  const parts: string[] = [];
  let part = "";
  let quote: "'" | '"' | undefined;
  let escaped = false;

  for (const character of command.trim()) {
    if (escaped) {
      part += character;
      escaped = false;
    } else if (character === "\\" && quote !== "'") {
      escaped = true;
    } else if (quote) {
      if (character === quote) quote = undefined;
      else part += character;
    } else if (character === "'" || character === '"') {
      quote = character;
    } else if (/\s/u.test(character)) {
      if (part !== "") {
        parts.push(part);
        part = "";
      }
    } else {
      part += character;
    }
  }

  if (escaped) part += "\\";
  if (quote) return [];
  if (part !== "") parts.push(part);
  return parts;
}

function editorCommand(deps: EditorDependencies): string[] | undefined {
  const configured = deps.env["EDITOR"];
  const candidates = configured
    ? [parseEditorCommand(configured), ["nvim"], ["vim"]]
    : [["nvim"], ["vim"]];
  for (const candidate of candidates) {
    const name = candidate[0];
    if (!name) continue;
    const executable = deps.findExecutable(name);
    if (executable) return [executable, ...candidate.slice(1)];
  }
  return undefined;
}

function dependencies(options: EditorOptions): EditorDependencies {
  return {
    env: options.env ?? Bun.env,
    exec: options.exec ?? defaultExec,
    findExecutable:
      options.findExecutable ?? ((name) => defaultFindExecutable(name)),
    temporaryRoot: options.temporaryRoot ?? tmpdir(),
    pollIntervalMs: options.pollIntervalMs ?? 150,
  };
}

export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

export function parseCmuxPaneResponse(content: string): string | undefined {
  try {
    const value: unknown = JSON.parse(content);
    if (typeof value !== "object" || value === null) return undefined;
    const record = value as Readonly<Record<string, unknown>>;
    return typeof record["surface_ref"] === "string"
      ? record["surface_ref"]
      : undefined;
  } catch {
    return undefined;
  }
}

export function canUseCmuxEditor(options: EditorOptions = {}): boolean {
  const deps = dependencies(options);
  return (
    deps.env["CMUX_WORKSPACE_ID"] !== undefined &&
    deps.findExecutable("cmux") !== undefined
  );
}

export async function monitorEditorFile(
  queryPath: string,
  donePath: string,
  initialSql: string,
  onSave: (sql: string) => Promise<void>,
  signal?: AbortSignal,
  pollIntervalMs = 150,
): Promise<void> {
  let lastSql = initialSql;
  while (!signal?.aborted) {
    const queryFile = Bun.file(queryPath);
    if (await queryFile.exists()) {
      const sql = await queryFile.text();
      if (sql !== lastSql) {
        lastSql = sql;
        if (sql.trim() !== "") await onSave(sql);
      }
    }
    if (await Bun.file(donePath).exists()) return;
    await Bun.sleep(pollIntervalMs);
  }
}

async function sendEditorCommand(
  cmux: string,
  workspace: string,
  surface: string,
  command: readonly string[],
  queryPath: string,
  donePath: string,
  deps: EditorDependencies,
): Promise<boolean> {
  const editorInvocation = [
    ...command.map(shellQuote),
    shellQuote(queryPath),
  ].join(" ");
  const completion = `printf done > ${shellQuote(donePath)}`;
  // A subshell makes the EXIT trap fire when the editor closes, without
  // leaving a trap installed in the interactive shell hosted by cmux.
  const shellCommand = `( trap ${shellQuote(completion)} EXIT HUP INT TERM; ${editorInvocation} )`;
  const result = await deps.exec(
    cmux,
    [
      "send",
      "--workspace",
      workspace,
      "--surface",
      surface,
      "--",
      `${shellCommand}\\n`,
    ],
    { env: deps.env },
  );
  return result.exitCode === 0;
}

export async function editQueryInCmux(
  currentSql: string,
  onSave: (sql: string) => Promise<void>,
  options: CmuxEditorOptions = {},
): Promise<CmuxEditorResult> {
  const deps = dependencies(options);
  const workspace = deps.env["CMUX_WORKSPACE_ID"];
  const cmux = deps.findExecutable("cmux");
  const command = editorCommand(deps);
  if (!workspace || !cmux || !command) {
    throw new Error("cmux editor integration is unavailable");
  }

  const directory = await mkdtemp(join(deps.temporaryRoot, "sqlclient-"));
  const queryPath = join(directory, "query.sql");
  const donePath = join(directory, "editor.done");
  let surface = options.surfaceRef;
  const focus = options.focus ?? true;
  let createdSurface: string | undefined;
  try {
    await Bun.write(queryPath, currentSql);

    if (surface && focus) {
      const focused = await deps.exec(
        cmux,
        ["focus-panel", "--workspace", workspace, "--panel", surface],
        { env: deps.env },
      );
      if (focused.exitCode !== 0) surface = undefined;
    }

    if (
      surface &&
      !(await sendEditorCommand(
        cmux,
        workspace,
        surface,
        command,
        queryPath,
        donePath,
        deps,
      ))
    ) {
      surface = undefined;
    }

    if (!surface) {
      const created = await deps.exec(
        cmux,
        [
          "--json",
          "new-pane",
          "--workspace",
          workspace,
          "--type",
          "terminal",
          "--direction",
          "right",
          "--focus",
          String(focus),
        ],
        { env: deps.env },
      );
      surface =
        created.exitCode === 0
          ? parseCmuxPaneResponse(created.stdout)
          : undefined;
      if (!surface) throw new Error("cmux could not create an editor pane");
      createdSurface = surface;
      if (
        !(await sendEditorCommand(
          cmux,
          workspace,
          surface,
          command,
          queryPath,
          donePath,
          deps,
        ))
      ) {
        throw new Error("cmux could not start the editor");
      }
    }

    await monitorEditorFile(
      queryPath,
      donePath,
      currentSql,
      onSave,
      options.signal,
      deps.pollIntervalMs,
    );
    return { surfaceRef: surface };
  } catch (error) {
    if (createdSurface) {
      await deps
        .exec(
          cmux,
          [
            "close-surface",
            "--workspace",
            workspace,
            "--surface",
            createdSurface,
          ],
          { env: deps.env },
        )
        .catch(() => undefined);
    }
    throw error;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function editQuery(
  currentSql: string,
  options: EditorOptions = {},
): Promise<EditResult> {
  const deps = dependencies(options);
  const command = editorCommand(deps);
  if (!command)
    throw new Error("No editor was found; set $EDITOR or install nvim/vim");

  const directory = await mkdtemp(join(deps.temporaryRoot, "sqlclient-"));
  const path = join(directory, "query.sql");
  try {
    await Bun.write(path, currentSql);
    const executable = command[0];
    if (!executable) throw new Error("No editor was found");
    const result = await deps.exec(executable, [...command.slice(1), path], {
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });
    if (result.exitCode !== 0)
      throw new Error("The editor exited unsuccessfully");
    const edited = await Bun.file(path).text();
    if (edited.trim() === "" || edited === currentSql)
      return { changed: false };
    return { changed: true, sql: edited };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
