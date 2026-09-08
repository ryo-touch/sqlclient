import { describe, expect, test } from "bun:test";
import { access } from "node:fs/promises";

import {
  editSqlExternally,
  ExternalEditorError,
  parseEditorCommand,
  resolveEditorCommand,
} from "../src/core/external-editor.ts";
import type { Exec } from "../src/util/exec.ts";

describe("external editor", () => {
  test("prefers VISUAL and preserves configured arguments", () => {
    expect(
      resolveEditorCommand({
        VISUAL: 'code --wait --profile "SQL work"',
        EDITOR: "vim",
      }),
    ).toEqual(["code", "--wait", "--profile", "SQL work"]);
    expect(resolveEditorCommand({ EDITOR: "nvim" })).toEqual(["nvim"]);
  });

  test("parses quoted and escaped arguments", () => {
    expect(parseEditorCommand(`editor 'one two' three\\ four ""`)).toEqual([
      "editor",
      "one two",
      "three four",
      "",
    ]);
  });

  test("rejects missing, empty, and malformed editor commands", () => {
    expect(() => resolveEditorCommand({})).toThrow(ExternalEditorError);
    expect(() => resolveEditorCommand({ VISUAL: "  " })).toThrow(
      "Editor command is empty",
    );
    expect(() => parseEditorCommand(`editor "unfinished`)).toThrow(
      "Failed to parse editor command",
    );
  });

  test("writes a temporary .sql file, reads edits, and removes it", async () => {
    let temporaryPath = "";
    const fakeExec: Exec = async (executable, args, options) => {
      temporaryPath = args.at(-1) ?? "";
      expect(executable).toBe("code");
      expect(args.slice(0, -1)).toEqual(["--wait"]);
      expect(temporaryPath.endsWith(".sql")).toBe(true);
      expect(await Bun.file(temporaryPath).text()).toBe("SELECT 1");
      expect(options).toMatchObject({
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
      });
      await Bun.write(temporaryPath, "SELECT 2\n");
      return { stdout: "", stderr: "", exitCode: 0 };
    };

    await expect(
      editSqlExternally("SELECT 1", ["code", "--wait"], fakeExec),
    ).resolves.toBe("SELECT 2\n");
    await expect(access(temporaryPath)).rejects.toThrow();
  });

  test("removes the temporary file when the editor fails", async () => {
    let temporaryPath = "";
    const fakeExec: Exec = async (_executable, args) => {
      temporaryPath = args.at(-1) ?? "";
      return { stdout: "", stderr: "", exitCode: 3 };
    };

    await expect(
      editSqlExternally("SELECT 1", ["false"], fakeExec),
    ).rejects.toThrow("External editor exited with status 3");
    await expect(access(temporaryPath)).rejects.toThrow();
  });
});
