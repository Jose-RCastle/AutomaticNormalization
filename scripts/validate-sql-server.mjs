/** Runs generated DDL in a disposable database and removes only that database. */
import sql from 'mssql';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
const file = process.argv[2];
if (!file) {
  console.error('Uso: npm run sql:validate -- ruta/al/SQL-generado.sql');
  process.exit(1);
}
const name = 'NormalizaDB_Check_' + randomUUID().replaceAll('-', '');
const ca = process.env.DB_CA_FILE ? await readFile(process.env.DB_CA_FILE, 'utf8') : undefined;
const config = {
  server: process.env.DB_SERVER,
  database: 'master',
  port: Number(process.env.DB_PORT || 1433),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  options: {
    encrypt: true,
    trustServerCertificate: false,
    ...(ca ? { cryptoCredentialsDetails: { ca } } : {}),
  },
  requestTimeout: 60000,
};
if (process.env.DB_AUTH === 'ntlm')
  config.authentication = {
    type: 'ntlm',
    options: {
      domain: process.env.DB_DOMAIN || '',
      userName: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
    },
  };
let admin,
  target,
  created = false;
try {
  if (!config.server || !config.user || !config.password)
    throw Error(
      'Configura DB_SERVER, DB_USER y DB_PASSWORD en .env. Se requiere permiso para crear una base temporal.',
    );
  const script = await readFile(file, 'utf8');
  if (
    !script.includes('-- SQL Server: estructuras propuestas') ||
    /\bUSE\s+|\b(?:CREATE|DROP|ALTER)\s+DATABASE\b/i.test(script)
  )
    throw Error(
      'Selecciona exclusivamente el DDL generado por la aplicación, sin USE ni operaciones sobre bases.',
    );
  admin = await new sql.ConnectionPool(config).connect();
  await admin.request().query(`CREATE DATABASE [${name}]`);
  created = true;
  target = await new sql.ConnectionPool({ ...config, database: name }).connect();
  await target.request().batch(script);
  const counts = await target
    .request()
    .query(
      'SELECT (SELECT COUNT(*) FROM sys.tables WHERE is_ms_shipped=0) AS tablas, (SELECT COUNT(*) FROM sys.foreign_keys) AS relaciones;',
    );
  console.log('DDL ejecutado correctamente en una base limpia:', counts.recordset[0]);
  console.log(
    'Esta comprobación valida ejecución del esquema, no migra datos ni demuestra reglas del negocio.',
  );
} catch (error) {
  console.error('No se pudo validar el DDL:', error.message);
  process.exitCode = 1;
} finally {
  await target?.close();
  if (created)
    try {
      await admin
        .request()
        .query(
          `ALTER DATABASE [${name}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [${name}];`,
        );
      console.log('Base temporal eliminada.');
    } catch {
      console.error('No se pudo eliminar la base temporal ' + name);
      process.exitCode = 1;
    }
  await admin?.close();
}
