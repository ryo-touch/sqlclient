import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { exec, type Exec } from "../util/exec.ts";

export class ExternalEditorError extends Error {}

export function parseEditorCommand(command: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quote: "'" | '"' | undefined;
  let started = false;

  for (let index = 0; index < command.length; index += 1) {
    const character = command[index]!;
    if (quote) {
      if (character === quote) {
        quote = undefined;
      } else if (character === "\\" && quote === '"') {
        index += 1;
        if (index >= command.length) {
          throw new ExternalEditorError("Failed to parse editor command");
        }
        current += command[index];
      } else {
        current += character;
      }
      started = true;
    } else if (character === "'" || character === '"') {
      quote = character;
      started = true;
    } else if (/\s/u.test(character)) {
      if (started) {
        parts.push(current);
        current = "";
        started = false;
      }
    } else if (character === "\\") {
      index += 1;
      if (index >= command.length) {
        throw new ExternalEditorError("Failed to parse editor command");
      }
      current += command[index];
      started = true;
    } else {
      current += character;
      started = true;
    }
  }

  if (quote) throw new ExternalEditorError("Failed to parse editor command");
  if (started) parts.push(current);
  return parts;
}

export function resolveEditorCommand(
  environment: Readonly<Record<string, string | undefined>> = Bun.env,
): string[] {
  const configured = environment["VISUAL"] ?? environment["EDITOR"];
  if (configured === undefined) {
    throw new ExternalEditorError(
      "Cannot open external editor: set $VISUAL or $EDITOR before starting sqlclient",
    );
  }
  const command = parseEditorCommand(configured);
  if (command.length === 0) {
    throw new ExternalEditorError("Editor command is empty");
  }
  return command;
}

export async function editSqlExternally(
  sql: string,
  editorCommand: readonly string[],
  run: Exec = exec,
): Promise<string> {
  if (editorCommand.length === 0) {
    throw new ExternalEditorError("Editor command is empty");
  }

  const directory = await mkdtemp(join(tmpdir(), "sqlclient-editor-"));
  const path = join(directory, "query.sql");
  try {
    await writeFile(path, sql, "utf8");
    const result = await run(
      editorCommand[0]!,
      [...editorCommand.slice(1), path],
      {
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
      },
    );
    if (result.exitCode !== 0) {
      throw new ExternalEditorError(
        `External editor exited with status ${result.exitCode}`,
      );
    }
    return await readFile(path, "utf8");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
