import type {
  ColumnRef,
  ConnectionListItem,
  ConnectionSummary,
  HistoryEntry,
  Mode,
  QueryError,
  ResultSet,
  SchemaRef,
  TableRef,
} from "./types.ts";

export interface AppState {
  connections: ConnectionListItem[];
  current?: ConnectionSummary;
  readOnlyVerified: boolean;
  schemas: SchemaRef[];
  tables: TableRef[];
  columns: ColumnRef[];
  result?: ResultSet;
  error?: QueryError;
  history: HistoryEntry[];
  warnings: string[];
  mode: Mode;
  previousMode?: Mode;
  selectedIndex: number;
  selectedColumnIndex: number;
  columnOffset: number;
  filter: string;
  filterEditing: boolean;
  message?: string;
  running: boolean;
  lastUpdated?: Date;
  selectedSchema?: string;
  selectedTable?: string;
  catalogPane: "schemas" | "tables";
  showSystemSchemas: boolean;
  resultSource?:
    { kind: "table"; schema: string; table: string } | { kind: "query" };
}

export const initialState: AppState = {
  connections: [],
  readOnlyVerified: false,
  schemas: [],
  tables: [],
  columns: [],
  history: [],
  warnings: [],
  mode: "connections",
  selectedIndex: 0,
  selectedColumnIndex: 0,
  columnOffset: 0,
  filter: "",
  filterEditing: false,
  running: false,
  catalogPane: "schemas",
  showSystemSchemas: false,
};

export type Action =
  | {
      type: "connectionsLoaded";
      connections: ConnectionListItem[];
      warnings: string[];
    }
  | { type: "moveSelection"; delta: number; itemCount: number }
  | { type: "moveToBoundary"; boundary: "first" | "last"; itemCount: number }
  | { type: "beginFilter" }
  | { type: "appendFilter"; text: string }
  | { type: "removeFilterCharacter" }
  | { type: "finishFilter" }
  | { type: "clearFilter" }
  | { type: "showMessage"; message: string }
  | { type: "clearMessage" }
  | { type: "addWarnings"; warnings: string[] }
  | { type: "connectionStarted" }
  | { type: "connectionSucceeded"; connection: ConnectionSummary }
  | { type: "connectionFailed"; error: QueryError }
  | { type: "returnedToConnections" }
  | { type: "showError"; error: QueryError }
  | { type: "clearError" };

function clampSelection(index: number, itemCount: number): number {
  if (itemCount <= 0) return 0;
  return Math.max(0, Math.min(index, itemCount - 1));
}

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "connectionsLoaded":
      return {
        ...state,
        connections: action.connections,
        warnings: [...state.warnings, ...action.warnings],
        selectedIndex: 0,
        lastUpdated: new Date(),
      };
    case "moveSelection":
      return {
        ...state,
        selectedIndex: clampSelection(
          state.selectedIndex + action.delta,
          action.itemCount,
        ),
      };
    case "moveToBoundary":
      return {
        ...state,
        selectedIndex:
          action.boundary === "first" ? 0 : Math.max(0, action.itemCount - 1),
      };
    case "beginFilter":
      return { ...state, filterEditing: true };
    case "appendFilter":
      return {
        ...state,
        filter: state.filter + action.text,
        selectedIndex: 0,
      };
    case "removeFilterCharacter":
      return {
        ...state,
        filter: state.filter.slice(0, -1),
        selectedIndex: 0,
      };
    case "finishFilter":
      return { ...state, filterEditing: false };
    case "clearFilter":
      return { ...state, filter: "", filterEditing: false, selectedIndex: 0 };
    case "showMessage":
      return { ...state, message: action.message };
    case "clearMessage":
      return { ...state, message: undefined };
    case "addWarnings":
      return { ...state, warnings: [...state.warnings, ...action.warnings] };
    case "connectionStarted":
      return {
        ...state,
        running: true,
        error: undefined,
        message: "Connecting…",
      };
    case "connectionSucceeded":
      return {
        ...state,
        current: action.connection,
        readOnlyVerified: true,
        mode: "catalog",
        previousMode: "connections",
        selectedIndex: 0,
        filter: "",
        running: false,
        message: undefined,
        error: undefined,
        lastUpdated: new Date(),
      };
    case "connectionFailed":
      return {
        ...state,
        current: undefined,
        readOnlyVerified: false,
        running: false,
        message: undefined,
        error: action.error,
      };
    case "returnedToConnections":
      return {
        ...state,
        current: undefined,
        readOnlyVerified: false,
        mode: "connections",
        previousMode: undefined,
        selectedIndex: 0,
        filter: "",
        error: undefined,
        message: undefined,
      };
    case "showError":
      return { ...state, error: action.error, running: false };
    case "clearError":
      return { ...state, error: undefined };
  }
}
