export interface FormattedValue {
  text: string;
  isNull: boolean;
}

function localDateTime(value: Date): string {
  const component = (part: number): string => String(part).padStart(2, "0");
  return `${value.getFullYear()}-${component(value.getMonth() + 1)}-${component(value.getDate())} ${component(value.getHours())}:${component(value.getMinutes())}:${component(value.getSeconds())}`;
}

function jsonValue(value: object): string {
  try {
    return JSON.stringify(value, (_, item: unknown) =>
      typeof item === "bigint" ? item.toString() : item,
    );
  } catch {
    return Object.prototype.toString.call(value);
  }
}

export function formatValue(value: unknown): FormattedValue {
  if (value === null) return { text: "NULL", isNull: true };
  if (value === undefined) return { text: "undefined", isNull: false };
  if (value instanceof Date)
    return { text: localDateTime(value), isNull: false };
  if (value instanceof Uint8Array) {
    return {
      text: `0x${Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("")}`,
      isNull: false,
    };
  }
  if (typeof value === "object")
    return { text: jsonValue(value), isNull: false };
  if (typeof value === "symbol")
    return { text: value.description ?? "Symbol", isNull: false };
  return { text: String(value), isNull: false };
}

export function truncateCell(value: string, width: number): string {
  if (width <= 0) return "";
  if (value.length > width)
    return width === 1 ? "…" : `${value.slice(0, width - 1)}…`;
  return value.padEnd(width);
}
