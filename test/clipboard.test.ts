import { expect, test } from "bun:test";

import { copyValue } from "../src/core/clipboard.ts";
import type { Exec } from "../src/util/exec.ts";

test("copies the display representation through pbcopy stdin", async () => {
  let invocation:
    { executable: string; args: readonly string[]; input?: string } | undefined;
  const fakeExec: Exec = async (executable, args, options) => {
    invocation = { executable, args, input: options?.input };
    return { stdout: "", stderr: "", exitCode: 0 };
  };
  await copyValue(null, fakeExec);
  expect(invocation).toEqual({ executable: "pbcopy", args: [], input: "NULL" });
});
