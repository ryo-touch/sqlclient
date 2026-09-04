import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { editQuery, parseEditorCommand } from "../src/core/editor.ts";
import type { Exec } from "../src/util/exec.ts";

describe("editor command parsing", () => {
  test("supports quoted arguments and escapes", () => {
    expect(
      parseEditorCommand(`code --wait "profile name" file\\ name`),
    ).toEqual(["code", "--wait", "profile name", "file name"]);
  });

  test("rejects an unterminated quote", () => {
    expect(parseEditorCommand(`editor "unfinished`)).toEqual([]);
  });
});

describe("external editor integration", () => {
  test("uses a .sql file, returns changed content, and removes the temporary directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "sqlclient-editor-test-"));
    let editedPath: string | undefined;
    const fakeExec: Exec = async (_executable, args) => {
      editedPath = args.at(-1);
      if (!editedPath) throw new Error("missing path");
      expect(editedPath.endsWith(".sql")).toBeTrue();
      expect(await Bun.file(editedPath).text()).toBe("SELECT 1");
      await Bun.write(editedPath, "SELECT 2\n");
      return { stdout: "", stderr: "", exitCode: 0 };
    };
    try {
      expect(
        await editQuery("SELECT 1", {
          env: { EDITOR: "fixture-editor --wait" },
          exec: fakeExec,
          findExecutable: () => "/bin/fixture-editor",
          temporaryRoot: root,
        }),
      ).toEqual({ changed: true, sql: "SELECT 2\n" });
      expect(editedPath).toBeDefined();
      expect(await Bun.file(editedPath ?? "").exists()).toBeFalse();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("does not execute empty or unchanged content", async () => {
    const fakeExec: Exec = async (_executable, args) => {
      const path = args.at(-1);
      if (!path) throw new Error("missing path");
      await Bun.write(path, "  \n");
      return { stdout: "", stderr: "", exitCode: 0 };
    };
    expect(
      await editQuery("SELECT 1", {
        env: { EDITOR: "fixture-editor" },
        exec: fakeExec,
        findExecutable: () => "/bin/fixture-editor",
      }),
    ).toEqual({ changed: false });
  });
});
