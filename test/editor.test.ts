import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  editQuery,
  editQueryInCmux,
  monitorEditorFile,
  parseCmuxPaneResponse,
  parseEditorCommand,
  shellQuote,
} from "../src/core/editor.ts";
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

  test("quotes shell arguments without allowing interpolation", () => {
    expect(shellQuote("path with ' quote")).toBe(`'path with '"'"' quote'`);
  });

  test("reads the created cmux surface reference", () => {
    expect(
      parseCmuxPaneResponse(
        JSON.stringify({ pane_ref: "pane:2", surface_ref: "surface:3" }),
      ),
    ).toBe("surface:3");
    expect(parseCmuxPaneResponse("not json")).toBeUndefined();
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

  test("runs saved SQL while a cmux editor remains open", async () => {
    const root = await mkdtemp(join(tmpdir(), "sqlclient-cmux-editor-test-"));
    const calls: string[][] = [];
    const saved: string[] = [];
    const fakeExec: Exec = async (executable, args) => {
      calls.push([executable, ...args]);
      if (args.includes("new-pane")) {
        return {
          stdout: JSON.stringify({ surface_ref: "surface:3" }),
          stderr: "",
          exitCode: 0,
        };
      }
      if (args[0] === "send") {
        const command = args.at(-1) ?? "";
        const queryPath = /([^\s'";]+query\.sql)/u.exec(command)?.[1];
        const donePath = /([^\s'";]+editor\.done)/u.exec(command)?.[1];
        if (!queryPath || !donePath) throw new Error("missing editor paths");
        setTimeout(() => void Bun.write(queryPath, "SELECT 2\n"), 5);
        setTimeout(() => void Bun.write(donePath, "done"), 20);
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    };

    try {
      const result = await editQueryInCmux(
        "SELECT 1",
        async (sql) => {
          saved.push(sql);
        },
        {
          env: { CMUX_WORKSPACE_ID: "workspace:1", EDITOR: "fixture-editor" },
          exec: fakeExec,
          findExecutable: (name) => `/bin/${name}`,
          temporaryRoot: root,
          pollIntervalMs: 2,
        },
      );
      expect(result).toEqual({ surfaceRef: "surface:3" });
      expect(saved).toEqual(["SELECT 2\n"]);
      expect(
        calls.some((call) => call.includes("--focus") && call.includes("true")),
      ).toBeTrue();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("observes multiple saves until the editor exits", async () => {
    const root = await mkdtemp(join(tmpdir(), "sqlclient-editor-watch-test-"));
    const queryPath = join(root, "query.sql");
    const donePath = join(root, "done");
    const saved: string[] = [];
    await Bun.write(queryPath, "SELECT 1");
    setTimeout(() => void Bun.write(queryPath, "SELECT 2"), 5);
    setTimeout(() => void Bun.write(queryPath, "SELECT 3"), 15);
    setTimeout(() => void Bun.write(donePath, "done"), 25);
    try {
      await monitorEditorFile(
        queryPath,
        donePath,
        "SELECT 1",
        async (sql) => {
          saved.push(sql);
        },
        undefined,
        2,
      );
      expect(saved).toEqual(["SELECT 2", "SELECT 3"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
