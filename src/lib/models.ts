/** El modelo conserva metadatos; nunca almacena filas ni credenciales. */
export interface Column {
  name: string;
  type: string;
  nullable: boolean;
  identity?: string;
  default?: string;
  computed?: boolean;
  expression?: string;
  expressionColumns?: string[];
  persisted?: boolean;
  collation?: string;
}
export interface ForeignKey {
  columns: string[];
  table: string;
  references: string[];
  onDelete?: string;
  onUpdate?: string;
}
export interface Table {
  name: string;
  sqlName?: string[];
  columns: Column[];
  primaryKey: string[];
  foreignKeys: ForeignKey[];
  uniqueKeys?: string[][];
  issues?: string[];
  warnings?: string[];
  checks?: { expression: string; columns: string[] }[];
  origin?: string;
  columnOrigins?: Record<string, string[]>;
  observedUniqueKeys?: string[][];
  listSource?: { column: string; separator: string };
}
export interface FD {
  left: string[];
  right: string[];
  evidence?: { rows: number; groups: number; repeatedGroups: number };
}
export type SampleRow = Record<string, string | null>;
export interface ImportDiagnostic {
  level: 'warning' | 'error';
  message: string;
  line: number;
  table?: string;
}
export interface ImportResult {
  tables: Table[];
  diagnostics: ImportDiagnostic[];
  ignoredStatements: number;
}
export const MAX_FILE_BYTES = 50 * 1024 * 1024;
export const MAX_COLUMNS = 256;
export const MAX_TABLES = 1000;
