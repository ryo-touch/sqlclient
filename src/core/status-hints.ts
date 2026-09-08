import type { Mode, QueryFocus } from "../types.ts";

export interface KeyHint {
  keys: string;
  label: string;
  /** Shorter wording used once the full labels no longer fit. */
  short?: string;
  /** Shorter key spelling for the same point, e.g. Tab/Shift+Tab → Tab. */
  shortKeys?: string;
}

// One ordered list per mode, most important first, because narrow terminals
// drop from the end and a wider terminal must always show a superset of a
// narrower one. Two hand-maintained lists per mode drifted apart instead: the
// wide result line lost `e` / `r` / `Tab` and the wide catalog line was the
// only one carrying Ctrl-X / Ctrl-R.
//
// Ctrl-X and Ctrl-R sit last everywhere they apply: they work in every mode, so
// they are the ones to lose when the row is squeezed, and the way out of the
// current mode has to survive longer than they do.

const CONNECTIONS: readonly KeyHint[] = [
  { keys: "j/k", label: "move" },
  { keys: "Enter", label: "connect" },
  { keys: "/", label: "filter" },
  { keys: "?", label: "help" },
  { keys: "q", label: "cancel/quit", short: "quit" },
];

const CATALOG: readonly KeyHint[] = [
  { keys: "j/k", label: "move" },
  { keys: "Enter", label: "schema→query/open table", short: "query/open" },
  { keys: "h/l", label: "tree" },
  { keys: "/", label: "filter" },
  { keys: "s", label: "system schemas", short: "sys" },
  { keys: "y", label: "copy" },
  { keys: "e", label: "SQL editor", short: "SQL" },
  { keys: "?", label: "help" },
  { keys: "q", label: "back" },
  { keys: "Tab", label: "query/result", short: "query" },
  { keys: "Ctrl-X", label: "switch" },
  { keys: "Ctrl-R", label: "reconnect" },
];

const RESULT: readonly KeyHint[] = [
  { keys: "j/k", label: "rows" },
  { keys: "h/l", label: "columns", short: "cols" },
  { keys: "n/p", label: "page" },
  { keys: "y", label: "copy" },
  { keys: "w", label: "TSV" },
  { keys: "e", label: "SQL editor", short: "SQL" },
  { keys: "r", label: "rerun" },
  { keys: "Tab", label: "query" },
  { keys: "?", label: "help" },
  { keys: "q", label: "catalog", short: "back" },
  { keys: "Ctrl-X", label: "switch" },
  { keys: "Ctrl-R", label: "reconnect" },
];

// No `? help` here, unlike every other surface: the editor takes `?` as text.
const QUERY_EDITOR: readonly KeyHint[] = [
  { keys: "type", label: "SQL" },
  { keys: "Cmd+Enter", label: "run" },
  // Leaving the pane and reaching the other panes both outrank the two Ctrl-
  // keys here: 80 columns minus the focus prefix affords five hints, and the
  // long "Ctrl-G external" is the one that does not make the cut.
  { keys: "Esc", label: "back" },
  { keys: "Ctrl-Space", label: "complete" },
  { keys: "Tab/Shift+Tab", label: "panes", shortKeys: "Tab" },
  { keys: "Ctrl-G", label: "external editor", short: "external" },
  { keys: "Ctrl-X", label: "switch" },
  { keys: "Ctrl-R", label: "reconnect" },
];

const QUERY_RESULT: readonly KeyHint[] = [
  { keys: "j/k", label: "rows" },
  { keys: "h/l", label: "columns", short: "cols" },
  { keys: "y", label: "copy" },
  { keys: "w", label: "TSV" },
  { keys: "Tab/Shift+Tab", label: "panes", shortKeys: "Tab" },
  { keys: "e", label: "editor" },
  { keys: "Esc", label: "back" },
  // Below the exit: at 80 columns the prefix leaves room for the keys above,
  // and help is the one hint a reader can do without on a narrow terminal.
  { keys: "?", label: "help" },
  { keys: "Ctrl-X", label: "switch" },
  { keys: "Ctrl-R", label: "reconnect" },
];

const QUERY_HISTORY: readonly KeyHint[] = [
  { keys: "j/k", label: "move" },
  { keys: "Enter", label: "load" },
  { keys: "r", label: "run" },
  { keys: "Tab/Shift+Tab", label: "panes", shortKeys: "Tab" },
  { keys: "Esc", label: "back" },
  { keys: "?", label: "help" },
  { keys: "Ctrl-X", label: "switch" },
  { keys: "Ctrl-R", label: "reconnect" },
];

const HELP: readonly KeyHint[] = [{ keys: "q/Esc", label: "close help" }];

const QUERY_PANES: Record<QueryFocus, readonly KeyHint[]> = {
  editor: QUERY_EDITOR,
  result: QUERY_RESULT,
  history: QUERY_HISTORY,
};

export function statusHints(
  mode: Mode,
  queryFocus: QueryFocus,
): readonly KeyHint[] {
  switch (mode) {
    case "connections":
      return CONNECTIONS;
    case "catalog":
      return CATALOG;
    case "result":
      return RESULT;
    case "query":
      return QUERY_PANES[queryFocus];
    case "help":
      return HELP;
  }
}

export interface FittedHints {
  hints: readonly KeyHint[];
  /** True once the full labels no longer fit and the short wording is used. */
  short: boolean;
}

function join(fitted: FittedHints): string {
  return fitted.hints
    .map((hint) =>
      fitted.short
        ? `${hint.shortKeys ?? hint.keys} ${hint.short ?? hint.label}`
        : `${hint.keys} ${hint.label}`,
    )
    .join(fitted.short ? " " : " · ");
}

/**
 * Picks how much of the list fits in `columns`: full labels first, then the
 * short wording, then fewer hints. Dropping only from the end keeps the hints
 * shown at any width a prefix of those shown at every wider terminal.
 */
export function fitStatusHints(
  hints: readonly KeyHint[],
  columns: number,
): FittedHints {
  const full: FittedHints = { hints, short: false };
  if (Bun.stringWidth(join(full)) <= columns) return full;
  for (let count = hints.length; count > 1; count -= 1) {
    const candidate: FittedHints = {
      hints: hints.slice(0, count),
      short: true,
    };
    if (Bun.stringWidth(join(candidate)) <= columns) return candidate;
  }
  return { hints: hints.slice(0, 1), short: true };
}

// Deliberately not exported: taking a raw column budget is exactly the shape
// that let a caller pass the terminal width and forget the prefix.
function renderStatusHints(hints: readonly KeyHint[], columns: number): string {
  return join(fitStatusHints(hints, columns));
}

// App renders the status bar inside a Box with paddingX={1}.
const HORIZONTAL_PADDING = 2;

function focusPrefix(mode: Mode, queryFocus: QueryFocus): string {
  return mode === "query" ? `focus: ${queryFocus} · ` : "";
}

/**
 * The whole status line for a terminal of `terminalColumns`, prefix included.
 * The prefix has to be inside the budget: leaving it to the caller is how the
 * hints came to overflow the query panes by its 16 columns.
 */
export function statusHintLine(
  mode: Mode,
  queryFocus: QueryFocus,
  terminalColumns: number,
): string {
  const prefix = focusPrefix(mode, queryFocus);
  const columns = Math.max(
    1,
    terminalColumns - HORIZONTAL_PADDING - Bun.stringWidth(prefix),
  );
  return prefix + renderStatusHints(statusHints(mode, queryFocus), columns);
}

