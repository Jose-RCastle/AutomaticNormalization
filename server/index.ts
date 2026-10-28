import express from 'express';
import sql from 'mssql';
const app = express();
app.disable('x-powered-by');
app.get('/api/health', (_req, res) => res.json({ status: 'ok', sqlServerConfigured: ['DB_SERVER', 'DB_DATABASE', 'DB_USER', 'DB_PASSWORD'].every(k => Boolean(process.env[k])) }));
app.get('/api/schema', async (_req, res) => {
  if (!['DB_SERVER', 'DB_DATABASE', 'DB_USER', 'DB_PASSWORD'].every(k => Boolean(process.env[k]))) { res.status(503).json({ error: 'Configura DB_SERVER, DB_DATABASE, DB_USER y DB_PASSWORD en el servidor. No introduzcas credenciales en el navegador.' }); return; }
  let pool: sql.ConnectionPool | undefined;
  try {
    pool = await new sql.ConnectionPool({ server: process.env['DB_SERVER']!, database: process.env['DB_DATABASE']!, user: process.env['DB_USER']!, password: process.env['DB_PASSWORD']!, port: Number(process.env['DB_PORT'] || 1433), options: { encrypt: true, trustServerCertificate: false }, connectionTimeout: 10000, requestTimeout: 10000 }).connect();
    const result = await pool.request().query(`SELECT s.name AS schemaName, t.name AS tableName, c.name AS columnName, ty.name AS typeName, c.max_length, c.precision, c.scale, c.is_nullable,
      ISNULL(ic.key_ordinal,0) AS keyOrdinal
      FROM sys.tables t JOIN sys.schemas s ON s.schema_id=t.schema_id JOIN sys.columns c ON c.object_id=t.object_id JOIN sys.types ty ON ty.user_type_id=c.user_type_id
      LEFT JOIN sys.indexes ix ON ix.object_id=t.object_id AND ix.is_primary_key=1
      LEFT JOIN sys.index_columns ic ON ic.object_id=t.object_id AND ic.index_id=ix.index_id AND ic.column_id=c.column_id
      WHERE t.is_ms_shipped=0 ORDER BY s.name,t.name,c.column_id;
      SELECT s.name AS schemaName,t.name AS tableName,f.name AS fkName,c.name AS columnName,rs.name AS refSchema,rt.name AS refTable,rc.name AS refColumn
      FROM sys.foreign_key_columns fc JOIN sys.foreign_keys f ON f.object_id=fc.constraint_object_id
      JOIN sys.tables t ON t.object_id=fc.parent_object_id JOIN sys.schemas s ON s.schema_id=t.schema_id JOIN sys.columns c ON c.object_id=t.object_id AND c.column_id=fc.parent_column_id
      JOIN sys.tables rt ON rt.object_id=fc.referenced_object_id JOIN sys.schemas rs ON rs.schema_id=rt.schema_id JOIN sys.columns rc ON rc.object_id=rt.object_id AND rc.column_id=fc.referenced_column_id
      ORDER BY f.object_id,fc.constraint_column_id;`);
    const sets = result.recordsets as unknown as any[][];
    const tables = new Map<string, any>();
    for (const r of sets[0]) {
      const name = `${r.schemaName}.${r.tableName}`;
      if (!tables.has(name)) tables.set(name, { name, columns: [], primaryKey: [], foreignKeys: [], keys: [] });
      const t = tables.get(name); let type = r.typeName.toUpperCase();
      if (['VARCHAR','CHAR','VARBINARY','BINARY','NVARCHAR','NCHAR'].includes(type)) type += `(${r.max_length === -1 ? 'MAX' : r.max_length / (type.startsWith('N') ? 2 : 1)})`;
      else if (['DECIMAL','NUMERIC'].includes(type)) type += `(${r.precision},${r.scale})`;
      else if (['DATETIME2','DATETIMEOFFSET','TIME'].includes(type)) type += `(${r.scale})`;
      t.columns.push({ name: r.columnName, type, nullable: r.is_nullable });
      if (r.keyOrdinal) t.keys.push({ name: r.columnName, order: r.keyOrdinal });
    }
    for (const r of sets[1]) {
      const t = tables.get(`${r.schemaName}.${r.tableName}`); if (!t) continue;
      let f = t.foreignKeys.find((x: any) => x.id === r.fkName);
      if (!f) { f = { id: r.fkName, columns: [], table: `${r.refSchema}.${r.refTable}`, references: [] }; t.foreignKeys.push(f); }
      f.columns.push(r.columnName); f.references.push(r.refColumn);
    }
    res.json([...tables.values()].map(({ keys, ...t }) => ({ ...t, primaryKey: keys.sort((a: any,b: any) => a.order-b.order).map((k: any) => k.name) })));
  } catch { res.status(502).json({ error: 'No se pudo consultar SQL Server. Revisa conectividad, permisos VIEW DEFINITION y el certificado TLS del servidor.' }); }
  finally { await pool?.close(); }
});
app.listen(Number(process.env['API_PORT'] || 3001), '127.0.0.1', () => console.log('API de metadatos disponible en puerto ' + (process.env['API_PORT'] || 3001)));
