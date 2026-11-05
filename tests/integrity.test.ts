import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseWithSqlGlot } from '../server/sqlglot';
import { automaticNormalization, ParsedTable } from '../src/lib/automatic';
import { exportSQL } from '../src/lib/exporters';
import { validateProfileReferences } from '../server/profile-integrity';

async function parse(sql: string) {
  return ((await parseWithSqlGlot(sql)) as { tables: ParsedTable[] }).tables;
}
test('clave y regla confirmadas se contrastan también después de la fila 1000', async () => {
  const [t] = await parse(
    'CREATE TABLE T(Id INT, V INT); INSERT INTO T VALUES ' +
      Array.from({ length: 1001 }, (_, i) => `(${i === 1000 ? 1 : i + 1},${i + 1})`).join(','),
  );
  t.review = { primaryKey: ['Id'], atomicConfirmed: true, rulesComplete: true };
  assert.match(automaticNormalization(t).error || '', /contradice la clave/);
  t.review = {
    syntheticKey: true,
    atomicConfirmed: true,
    rulesComplete: true,
    acceptedRules: [{ left: ['Id'], right: ['V'] }],
  };
  assert.match(automaticNormalization(t).error || '', /contradice Id/);
});
test('clave confirmada utiliza la igualdad SQL de la intercalación', async () => {
  const [t] = await parse(
    "CREATE TABLE T(C VARCHAR(10), V INT); INSERT INTO T VALUES('a',1),('A',2);",
  );
  t.review = { primaryKey: ['C'], atomicConfirmed: true, rulesComplete: true };
  assert.match(automaticNormalization(t).error || '', /contradice la clave/);
});
test('intercalación no soportada conserva datos originales y bloquea certificación', async () => {
  const [t] = await parse(
    "CREATE TABLE T(Id INT PRIMARY KEY, C NVARCHAR(10) COLLATE Turkish_CI_AS); INSERT INTO T VALUES(1,N'İ');",
  );
  t.review = { atomicConfirmed: true, rulesComplete: true };
  assert.equal(t.profile?.sampleRows?.[0]['C'], 'İ');
  assert.ok(automaticNormalization(t).pending.some((s) => /intercalación/.test(s)));
  assert.equal(automaticNormalization(t).verification?.status, 'unavailable');
});
test('las exportaciones rechazan FK incompatibles y permiten longitudes de texto diferentes', async () => {
  const bad = await parse(
    'CREATE TABLE P(Id INT PRIMARY KEY); CREATE TABLE H(Id INT PRIMARY KEY, Pid VARCHAR(10) REFERENCES P(Id));',
  );
  assert.throws(() => exportSQL(bad), /incompatibles/);
  const good = await parse(
    'CREATE TABLE P(Id VARCHAR(10) PRIMARY KEY); CREATE TABLE H(Id INT PRIMARY KEY, Pid VARCHAR(20) REFERENCES P(Id));',
  );
  assert.doesNotThrow(() => exportSQL(good));
  good[1].columns[1].collation = 'Latin1_General_100_CS_AS';
  assert.throws(() => exportSQL(good), /incompatibles/);
});
test('perfiles de SQL Server distinguen huérfanos de destinos muestreados o sin permiso SELECT', async () => {
  const original = await parse(
    'CREATE TABLE P(Id INT PRIMARY KEY); CREATE TABLE H(Id INT PRIMARY KEY, Pid INT REFERENCES P(Id)); INSERT INTO P VALUES(1); INSERT INTO H VALUES(1,999);',
  );
  for (const mode of ['complete', 'sampled', 'unavailable']) {
    const tables = structuredClone(original);
    tables.forEach((t) => (t.issues = []));
    if (mode === 'sampled') tables[0].profile!.sampled = true;
    if (mode === 'unavailable') delete tables[0].profile;
    validateProfileReferences(tables);
    if (mode === 'complete') assert.ok(tables[1].issues?.some((i) => i.includes('huérfanos')));
    else {
      assert.deepEqual(tables[1].issues, []);
      assert.ok(tables[1].profile?.comparisonIssues?.some((i) => i.includes('incompletos')));
    }
  }
});
test('datos inválidos de los casos auditados bloquean la normalización', async () => {
  for (const sql of [
    'CREATE TABLE T(Id INT PRIMARY KEY, N INT NOT NULL DEFAULT 5); INSERT INTO T VALUES(1,NULL);',
    "CREATE TABLE T(C VARCHAR(10) COLLATE Latin1_General_100_CI_AS PRIMARY KEY); INSERT INTO T VALUES('a'),('A');",
  ]) {
    const [t] = await parse(sql);
    t.review = { atomicConfirmed: true, rulesComplete: true };
    assert.ok(automaticNormalization(t).error);
  }
});
