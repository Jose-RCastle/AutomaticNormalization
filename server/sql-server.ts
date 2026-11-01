import sql from 'mssql';
import { Column, Table } from '../src/lib/models';
import { SCHEMA_QUERY } from './schema-query';
import { readFileSync } from 'node:fs';
import { profileRecords } from './sqlglot';
import { ParsedTable } from '../src/lib/automatic';
import { tokenize } from '../src/lib/sql/lexer';

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
  collation?: string;
  defaultExpression?: string;
  computedExpression?: string;
  is_persisted?: boolean;
  identityStart?: string;
  identityStep?: string;
}
interface ReferenceRow {
  schemaName: string;
  tableName: string;
  fkName: string;
  columnName: string;
  refSchema: string;
  refTable: string;
  refColumn: string;
  onDelete?: string;
  onUpdate?: string;
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
  checkRows: { schemaName: string; tableName: string; expression: string }[] = [],
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
      collation: row.collation || undefined,
      default: row.defaultExpression || undefined,
      identity:
        row.identityStart != null
          ? `IDENTITY(${row.identityStart},${row.identityStep})`
          : undefined,
      expression: row.computedExpression || undefined,
      persisted: !!row.is_persisted,
    };
    table.columns.push(column);
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
        onDelete: row.onDelete?.replaceAll('_', ' '),
        onUpdate: row.onUpdate?.replaceAll('_', ' '),
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
  const mentioned = (table: Table, expression: string) => {
    const names = [...tokenize(expression)]
      .filter((t) => t.kind !== 'string')
      .map((t) => t.value.toLowerCase());
    return table.columns.filter((c) => names.includes(c.name.toLowerCase())).map((c) => c.name);
  };
  for (const table of tables.values())
    for (const column of table.columns)
      if (column.expression) column.expressionColumns = mentioned(table, column.expression);
  for (const row of checkRows) {
    const table = tables.get(`${row.schemaName}.${row.tableName}`);
    if (table)
      (table.checks ||= []).push({
        expression: row.expression,
        columns: mentioned(table, row.expression),
      });
  }
  return [...tables.values()];
}
export interface ConnectionInput {
  server: string;
  database: string;
  user: string;
  password: string;
  port?: number;
}
export async function readSchema(
  connection?: ConnectionInput,
  includeData = true,
  signal?: AbortSignal,
  rules: Record<string, string> = {},
): Promise<ParsedTable[]> {
  const caFile = process.env['DB_CA_FILE'];
  const pool = new sql.ConnectionPool({
    server: connection?.server || process.env['DB_SERVER']!,
    database: connection?.database || process.env['DB_DATABASE']!,
    user: connection?.user || process.env['DB_USER']!,
    password: connection?.password || process.env['DB_PASSWORD']!,
    port: Number(connection?.port || process.env['DB_PORT'] || 1433),
    options: {
      encrypt: true,
      trustServerCertificate: false,
      ...(caFile ? { cryptoCredentialsDetails: { ca: readFileSync(caFile, 'utf8') } } : {}),
    },
    connectionTimeout: 10_000,
    requestTimeout: 30_000,
  });
  try {
    await pool.connect();
    const result = await pool.request().query(SCHEMA_QUERY);
    const sets = result.recordsets as unknown as [
      ColumnRow[],
      ReferenceRow[],
      UniqueRow[],
      { schemaName: string; tableName: string; expression: string }[],
    ];
    const tables: ParsedTable[] = mapSchema(sets[0], sets[1], sets[2], sets[3]);
    for (const [name, text] of Object.entries(rules)) {
      const table = tables.find((t) => t.name.toLowerCase() === name.toLowerCase());
      if (!table) throw Error('Reglas para tabla ausente: ' + name);
      table.rules = text.split('\n').filter(Boolean);
    }
    if (tables.length > 1000)
      throw Error('La conexión excede 1000 tablas. Selecciona una base más pequeña.');
    if (includeData)
      for (const table of tables) {
        if (signal?.aborted) throw Error('Lectura cancelada.');
        if (table.columns.length > 256) {
          table.issues = ['La tabla excede 256 columnas.'];
          continue;
        }
        const request = pool.request();
        const abort = () => request.cancel();
        signal?.addEventListener('abort', abort, { once: true });
        try {
          const name = table.sqlName!.map(quote).join('.');
          const order = table.primaryKey.length
            ? ' ORDER BY ' + table.primaryKey.map(quote).join(', ')
            : '';
          const sample = await request.query(
            `SELECT TOP (10001) ${table.columns.map((c) => quote(c.name)).join(', ')} FROM ${name}${order}`,
          );
          const rows = sample.recordset.slice(0, 10000).map((row) =>
            Object.fromEntries(
              table.columns.map((c) => {
                const v = row[c.name];
                return [
                  c.name,
                  v == null
                    ? null
                    : v instanceof Date
                      ? v.toISOString()
                      : Buffer.isBuffer(v)
                        ? v.toString('hex')
                        : String(v),
                ];
              }),
            ),
          );
          table.profile = await profileRecords(
            table,
            rows,
            sample.recordset.length > 10000,
            signal,
          );
          table.warnings = [
            'Perfil de registros leído con SELECT. Las dependencias observadas no sustituyen las reglas del negocio.',
          ];
        } catch (error) {
          if (signal?.aborted) throw error;
          table.warnings = [
            'No se pudieron perfilar los datos de esta tabla. Revisa el permiso SELECT; el análisis se limita a su estructura.',
          ];
        } finally {
          signal?.removeEventListener('abort', abort);
        }
      }
    return tables;
  } finally {
    await pool.close();
  }
}
