/** Creates a local SQL Server with a private CA. No credentials are committed or printed. */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import sql from 'mssql';
const root = resolve('.local/sqlserver');
const tls = resolve(root, 'tls');
const exists = async (path) =>
  access(path).then(
    () => true,
    () => false,
  );
const run = (command, args, env = process.env) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(Error(`${command} terminó con código ${code}`)),
    );
  });
try {
  await mkdir(root, { recursive: true, mode: 0o700 });
  await mkdir(tls, { recursive: true, mode: 0o755 });
  if (!(await exists(resolve(root, 'connection.json')))) {
    const password = 'Ndb!' + randomBytes(28).toString('base64url') + '9a';
    await writeFile(resolve(root, 'connection.json'), JSON.stringify({ password, port: 14333 }), {
      mode: 0o600,
    });
  }
  const connection = JSON.parse(await readFile(resolve(root, 'connection.json'), 'utf8'));
  if (!(await exists(resolve(tls, 'server.pem')))) {
    await run('openssl', [
      'req',
      '-x509',
      '-newkey',
      'rsa:3072',
      '-nodes',
      '-days',
      '365',
      '-subj',
      '/CN=NormalizaDB local CA',
      '-keyout',
      resolve(root, 'ca.key'),
      '-out',
      resolve(tls, 'ca.pem'),
    ]);
    await run('openssl', [
      'req',
      '-newkey',
      'rsa:3072',
      '-nodes',
      '-subj',
      '/CN=localhost',
      '-keyout',
      resolve(tls, 'server.key'),
      '-out',
      resolve(root, 'server.csr'),
    ]);
    await writeFile(
      resolve(root, 'extensions.cnf'),
      'subjectAltName=DNS:localhost,DNS:sqlserver,IP:127.0.0.1\nextendedKeyUsage=serverAuth\nkeyUsage=digitalSignature,keyEncipherment\n',
    );
    await run('openssl', [
      'x509',
      '-req',
      '-days',
      '365',
      '-in',
      resolve(root, 'server.csr'),
      '-CA',
      resolve(tls, 'ca.pem'),
      '-CAkey',
      resolve(root, 'ca.key'),
      '-CAcreateserial',
      '-extfile',
      resolve(root, 'extensions.cnf'),
      '-out',
      resolve(tls, 'server.pem'),
    ]);
    // The SQL Server container runs as UID 10001; the host parent directory protects the private key.
    const { chmod } = await import('node:fs/promises');
    await chmod(resolve(tls, 'server.key'), 0o644);
    await chmod(resolve(root, 'ca.key'), 0o600);
  }
  await writeFile(
    resolve(root, 'mssql.conf'),
    '[network]\ntlscert = /var/opt/mssql/tls/server.pem\ntlskey = /var/opt/mssql/tls/server.key\ntlsprotocols = 1.2\nforceencryption = 1\n',
  );
  await run('docker', ['compose', 'up', '-d'], {
    ...process.env,
    LOCAL_SQL_PASSWORD: connection.password,
    LOCAL_SQL_PORT: String(connection.port),
  });
  const ca = await readFile(resolve(tls, 'ca.pem'), 'utf8');
  let ready = false;
  for (let attempt = 0; attempt < 45; attempt++) {
    const pool = new sql.ConnectionPool({
      server: 'localhost',
      port: connection.port,
      database: 'master',
      user: 'sa',
      password: connection.password,
      connectionTimeout: 3000,
      options: { encrypt: true, trustServerCertificate: false, cryptoCredentialsDetails: { ca } },
    });
    try {
      await pool.connect();
      await pool.request().query("IF DB_ID(N'NormalizaDB') IS NULL CREATE DATABASE [NormalizaDB]");
      ready = true;
      break;
    } catch {
      if (attempt % 5 === 0) console.log('Esperando a SQL Server…');
    } finally {
      await pool.close();
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  if (!ready) throw Error('SQL Server no inició. Revisa docker compose logs sqlserver.');
  const env = `DB_SERVER=localhost\nDB_PORT=${connection.port}\nDB_DATABASE=NormalizaDB\nDB_USER=sa\nDB_PASSWORD=${connection.password}\nDB_CA_FILE=${resolve(tls, 'ca.pem')}\n`;
  await writeFile('.env.sqlserver.local', env, { mode: 0o600 });
  if (!(await exists('.env'))) await writeFile('.env', env, { mode: 0o600 });
  console.log(
    'SQL Server listo. Base vacía NormalizaDB, localhost:' +
      connection.port +
      '. Inicia npm run dev:local y elige la conexión configurada del servidor. Puedes cargar tus tablas desde SSMS o Azure Data Studio; no se insertaron ejemplos.',
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
