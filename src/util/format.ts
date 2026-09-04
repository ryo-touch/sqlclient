export interface FormattedValue {
  text: string;
  isNull: boolean;
}

export function formatDateTime(value: Date): string {
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
    return { text: formatDateTime(value), isNull: false };
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

function truncateToWidth(value: string, width: number): string {
  if (Bun.stringWidth(value) <= width) return value;
  if (width <= 1) return "…";

  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  let result = "";
  let used = 0;
  for (const { segment } of segmenter.segment(value)) {
    const segmentWidth = Bun.stringWidth(segment);
    if (used + segmentWidth > width - 1) break;
    result += segment;
    used += segmentWidth;
  }
  return `${result}…`;
}

export function truncateCell(
  value: string,
  width: number,
  align: "left" | "right" = "left",
): string {
  if (width <= 0) return "";
  const truncated = truncateToWidth(value, width);
  const padding = " ".repeat(Math.max(0, width - Bun.stringWidth(truncated)));
  return align === "right"
    ? `${padding}${truncated}`
    : `${truncated}${padding}`;
}
