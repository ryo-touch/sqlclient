import { chmod, mkdir, rename } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname } from "node:path";

import type { HistoryEntry } from "../types.ts";

export const HISTORY_LIMIT = 500;

interface StoredHistoryEntry {
  sql: string;
  connection: string;
  executedAt: string;
  ok: boolean;
}

export interface LoadedHistory {
  entries: HistoryEntry[];
  warnings: string[];
}

function historyPath(path?: string): string {
  return path ?? `${homedir()}/.config/sqlclient/history.jsonl`;
}

function storedEntry(value: unknown): StoredHistoryEntry | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Readonly<Record<string, unknown>>;
  if (
    typeof record["sql"] !== "string" ||
    typeof record["connection"] !== "string" ||
    typeof record["executedAt"] !== "string" ||
    typeof record["ok"] !== "boolean"
  ) {
    return undefined;
  }
  const date = new Date(record["executedAt"]);
  if (Number.isNaN(date.getTime())) return undefined;
  return {
    sql: record["sql"],
    connection: record["connection"],
    executedAt: record["executedAt"],
    ok: record["ok"],
  };
}

export function parseHistory(content: string): LoadedHistory {
  const entries: HistoryEntry[] = [];
  let invalidLines = 0;
  for (const line of content.split(/\r?\n/u)) {
    if (line.trim() === "") continue;
    try {
      const stored = storedEntry(JSON.parse(line));
      if (!stored) {
        invalidLines += 1;
        continue;
      }
      entries.push({ ...stored, executedAt: new Date(stored.executedAt) });
    } catch {
      invalidLines += 1;
    }
  }
  return {
    entries: entries.slice(0, HISTORY_LIMIT),
    warnings:
      invalidLines === 0
        ? []
        : [
            `Ignored ${invalidLines} invalid query history line${invalidLines === 1 ? "" : "s"}`,
          ],
  };
}

export async function loadHistory(path?: string): Promise<LoadedHistory> {
  const file = Bun.file(historyPath(path));
  if (!(await file.exists())) return { entries: [], warnings: [] };
  try {
    return parseHistory(await file.text());
  } catch {
    return { entries: [], warnings: ["The query history could not be read"] };
  }
}

function serializeHistory(entries: readonly HistoryEntry[]): string {
  return `${entries
    .slice(0, HISTORY_LIMIT)
    .map((entry) =>
      JSON.stringify({ ...entry, executedAt: entry.executedAt.toISOString() }),
    )
    .join("\n")}\n`;
}

export async function saveHistory(
  entries: readonly HistoryEntry[],
  path?: string,
): Promise<void> {
  const target = historyPath(path);
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.${process.pid}.tmp`;
  await Bun.write(temporary, serializeHistory(entries));
  await chmod(temporary, 0o600);
  await rename(temporary, target);
}

export async function recordHistory(
  entry: HistoryEntry,
  path?: string,
): Promise<LoadedHistory> {
  const loaded = await loadHistory(path);
  const entries = [entry, ...loaded.entries].slice(0, HISTORY_LIMIT);
  await saveHistory(entries, path);
  return { entries, warnings: loaded.warnings };
}
