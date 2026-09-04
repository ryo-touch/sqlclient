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
}

export type EditorOptions = Partial<EditorDependencies>;

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
  };
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
