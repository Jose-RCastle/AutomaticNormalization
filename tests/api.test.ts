import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/app';
import { mapSchema } from '../server/sql-server';

async function withApi(app: ReturnType<typeof createApp>, verify: (url: string) => Promise<void>) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('Puerto no disponible');
  try {
    await verify(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}
test('API: salud y error controlado sin credenciales', async () => {
  await withApi(
    createApp(() => false),
    async (url) => {
      const health = await (await fetch(url + '/api/health')).json();
      assert.equal(health.status, 'ok');
      assert.equal(health.sqlServerConfigured, false);
      const response = await fetch(url + '/api/schema');
      assert.equal(response.status, 503);
      assert.match((await response.json()).error, /DB_SERVER/);
    },
  );
});
test('API: entrega metadatos y no filtra errores internos de conexión', async () => {
  await withApi(
    createApp(
      () => true,
      async () => [],
    ),
    async (url) => assert.deepEqual(await (await fetch(url + '/api/schema')).json(), []),
  );
  await withApi(
    createApp(
      () => true,
      async () => {
        throw Error('password=never-return-this');
      },
    ),
    async (url) => {
      const response = await fetch(url + '/api/schema');
      assert.equal(response.status, 502);
      assert.doesNotMatch(await response.text(), /never-return-this/);
    },
  );
});
test('mapeo SQL Server: orden de clave compuesta, longitudes Unicode y UNIQUE', () => {
  const base = {
    schemaName: 'dbo',
    tableName: 'T',
    typeName: 'nvarchar',
    max_length: 80,
    precision: 0,
    scale: 0,
    is_nullable: false,
    is_computed: false,
    is_user_defined: false,
    typeSchema: 'sys',
  };
  const tables = mapSchema(
    [
      { ...base, columnName: 'B', keyOrdinal: 2 },
      { ...base, columnName: 'A', keyOrdinal: 1 },
    ],
    [],
    [{ schemaName: 'dbo', tableName: 'T', keyName: 'UQ', columnName: 'B' }],
  );
  assert.deepEqual(tables[0].primaryKey, ['A', 'B']);
  assert.equal(tables[0].columns[0].type, 'NVARCHAR(40)');
  assert.deepEqual(tables[0].uniqueKeys, [['B']]);
});
