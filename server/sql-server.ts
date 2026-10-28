import sql from 'mssql';
import { Column, Table } from '../src/lib/models';
import { SCHEMA_QUERY } from './schema-query';

interface ColumnRow {
  schemaName: string;
  tableName: string;
  columnName: string;
  typeName: string;
  max_length: number;
  precision: number;
  scale: number;
  is_nullable: boolean;
  keyOrdinal: number;
  is_computed: boolean;
  is_user_defined: boolean;
  typeSchema: string;
}
interface ReferenceRow {
  schemaName: string;
  tableName: string;
  fkName: string;
  columnName: string;
  refSchema: string;
  refTable: string;
  refColumn: string;
}
interface UniqueRow {
  schemaName: string;
  tableName: string;
  keyName: string;
  columnName: string;
}
const REQUIRED_VARIABLES = ['DB_SERVER', 'DB_DATABASE', 'DB_USER', 'DB_PASSWORD'];
export const isConfigured = () => REQUIRED_VARIABLES.every((name) => Boolean(process.env[name]));
const quote = (name: string) => '[' + name.replace(/]/g, ']]') + ']';

function columnType(row: ColumnRow): string {
  if (row.is_user_defined) return `${quote(row.typeSchema)}.${quote(row.typeName)}`;
  let type = row.typeName.toUpperCase();
  if (['VARCHAR', 'CHAR', 'VARBINARY', 'BINARY', 'NVARCHAR', 'NCHAR'].includes(type)) {
    const length = row.max_length === -1 ? 'MAX' : row.max_length / (type.startsWith('N') ? 2 : 1);
    type += `(${length})`;
  } else if (['DECIMAL', 'NUMERIC'].includes(type)) type += `(${row.precision},${row.scale})`;
  else if (['DATETIME2', 'DATETIMEOFFSET', 'TIME'].includes(type)) type += `(${row.scale})`;
  return type;
}
export function mapSchema(
  columns: ColumnRow[],
  references: ReferenceRow[],
  uniqueRows: UniqueRow[],
): Table[] {
  const tables = new Map<string, Table>();
  const keys = new Map<string, { column: string; order: number }[]>();
  for (const row of columns) {
    const name = `${row.schemaName}.${row.tableName}`;
    if (!tables.has(name))
      tables.set(name, {
        name,
        sqlName: [row.schemaName, row.tableName],
        columns: [],
        primaryKey: [],
        foreignKeys: [],
        uniqueKeys: [],
      });
    const table = tables.get(name)!;
    const column: Column = {
      name: row.columnName,
      type: columnType(row),
      nullable: row.is_nullable,
      computed: row.is_computed,
    };
    table.columns.push(column);
    if (row.is_computed)
      (table.issues ||= []).push(
        `Columna calculada ${row.columnName}: revisa su expresión antes de transformar.`,
      );
    if (row.keyOrdinal) {
      const list = keys.get(name) || [];
      list.push({ column: row.columnName, order: row.keyOrdinal });
      keys.set(name, list);
    }
  }
  const referencesByName = new Map<string, Table['foreignKeys'][number]>();
  for (const row of references) {
    const name = `${row.schemaName}.${row.tableName}`,
      table = tables.get(name);
    if (!table) continue;
    const key = `${name}:${row.fkName}`;
    if (!referencesByName.has(key)) {
      const reference = {
        columns: [],
        table: `${row.refSchema}.${row.refTable}`,
        references: [],
      } as Table['foreignKeys'][number];
      referencesByName.set(key, reference);
      table.foreignKeys.push(reference);
    }
    const reference = referencesByName.get(key)!;
    reference.columns.push(row.columnName);
    reference.references.push(row.refColumn);
  }
  const uniqueByName = new Map<string, string[]>();
  for (const row of uniqueRows) {
    const name = `${row.schemaName}.${row.tableName}`,
      table = tables.get(name);
    if (!table) continue;
    const id = `${name}:${row.keyName}`;
    if (!uniqueByName.has(id)) {
      const key: string[] = [];
      uniqueByName.set(id, key);
      table.uniqueKeys!.push(key);
    }
    uniqueByName.get(id)!.push(row.columnName);
  }
  for (const [name, table] of tables)
    table.primaryKey = (keys.get(name) || [])
      .sort((a, b) => a.order - b.order)
      .map((k) => k.column);
  return [...tables.values()];
}
export async function readSchema(): Promise<Table[]> {
  const pool = new sql.ConnectionPool({
    server: process.env['DB_SERVER']!,
    database: process.env['DB_DATABASE']!,
    user: process.env['DB_USER']!,
    password: process.env['DB_PASSWORD']!,
    port: Number(process.env['DB_PORT'] || 1433),
    options: { encrypt: true, trustServerCertificate: false },
    connectionTimeout: 10_000,
    requestTimeout: 10_000,
  });
  try {
    await pool.connect();
    const result = await pool.request().query(SCHEMA_QUERY);
    const sets = result.recordsets as unknown as [ColumnRow[], ReferenceRow[], UniqueRow[]];
    return mapSchema(sets[0], sets[1], sets[2]);
  } finally {
    await pool.close();
  }
}
