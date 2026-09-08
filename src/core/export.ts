import { mkdir, open } from "node:fs/promises";
import { join } from "node:path";

import type { ResultSet } from "../types.ts";
import { formatValue } from "../util/format.ts";

function tsvCell(value: unknown): string {
  const text =
    value === null
      ? ""
      : value instanceof Date
        ? value.toISOString()
        : formatValue(value).text;
  return /[\t\r\n"]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function resultToTsv(result: ResultSet): string {
  const lines = [
    result.columns.map(tsvCell).join("\t"),
    ...result.rows.map((row) => row.map(tsvCell).join("\t")),
  ];
  return `${lines.join("\n")}\n`;
}

function timestamp(date: Date): string {
  const part = (value: number): string => String(value).padStart(2, "0");
  return `${date.getFullYear()}${part(date.getMonth() + 1)}${part(date.getDate())}-${part(date.getHours())}${part(date.getMinutes())}${part(date.getSeconds())}`;
}

export async function exportResultTsv(
  result: ResultSet,
  directory = process.cwd(),
  now = new Date(),
): Promise<string> {
  await mkdir(directory, { recursive: true });
  const base = `sqlclient-result-${timestamp(now)}`;
  for (let suffix = 1; ; suffix += 1) {
    const filename = `${base}${suffix === 1 ? "" : `-${suffix}`}.tsv`;
    const path = join(directory, filename);
    try {
      const file = await open(path, "wx", 0o600);
      try {
        await file.writeFile(resultToTsv(result), "utf8");
      } finally {
        await file.close();
      }
      return path;
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "EEXIST"
      ) {
        continue;
      }
      throw error;
    }
  }
}
