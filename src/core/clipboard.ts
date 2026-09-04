import { exec as defaultExec, type Exec } from "../util/exec.ts";
import { formatValue } from "../util/format.ts";

export async function copyValue(
  value: unknown,
  run: Exec = defaultExec,
): Promise<void> {
  const result = await run("pbcopy", [], { input: formatValue(value).text });
  if (result.exitCode !== 0) throw new Error("pbcopy failed");
}
