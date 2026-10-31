import { sqlglotPython } from '../scripts/python-runtime';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { automaticNormalization, ParsedTable } from '../src/lib/automatic';
import { exportSQL } from '../src/lib/exporters';
import { assembleProject } from '../src/lib/project';
import { parseSQL } from '../src/lib/normalization';

const fromSQL = (sql: string): ParsedTable =>
  JSON.parse(
    execFileSync(sqlglotPython(), ['-X', 'utf8', 'python/sql_analysis.py'], {
      input: sql,
      encoding: 'utf8',
    }),
  ).tables[0];
test('PARCELAS reproduce las etapas de clase y considera la clave alternativa compuesta', () => {
  const result = automaticNormalization(fromSQL(readFileSync('examples/parcelas.sql', 'utf8')));
  assert.equal(result.error, undefined);
  assert.equal(result.diagnosis?.form, '1FN');
  assert.ok(
    result.diagnosis?.keys.some(
      (k) => k.includes('NombreMunicipio') && k.includes('NumeroParcela'),
    ),
  );
  const sets = (stage: number) =>
    result.stages[stage].tables.map((t) =>
      t.columns
        .map((c) => c.name)
        .sort()
        .join(','),
    );
  assert.deepEqual(
    sets(1).sort(),
    ['Area,IdPropiedad,NombreMunicipio,NumeroParcela,Precio', 'Impuestos,NombreMunicipio'].sort(),
  );
  assert.deepEqual(
    sets(2).sort(),
    ['IdPropiedad,NombreMunicipio,NumeroParcela,Area', 'Area,Precio', 'NombreMunicipio,Impuestos']
      .map((s) => s.split(',').sort().join(','))
      .sort(),
  );
  assert.equal(parseSQL(exportSQL(result.stages[2].tables)).length, 3);
});
test('extrae grupos numerados, amplía la clave hija y mantiene las referencias en las tres etapas', () => {
  const result = automaticNormalization(
    fromSQL('CREATE TABLE P(Id INT PRIMARY KEY, Telefono1 VARCHAR(20), Telefono2 VARCHAR(20));'),
  );
  assert.equal(result.error, undefined);
  assert.match(result.form, /No normalizada/);
  for (const stage of result.stages) {
    const child = stage.tables.find((t) => t.name.endsWith('_Valores'))!;
    assert.deepEqual(child.primaryKey, ['Id', 'Posicion']);
    assert.ok(stage.tables.some((t) => t.name === child.foreignKeys[0].table));
  }
});
test('DDL sin reglas no se presenta como certificación; ausencia de clave bloquea transformación', () => {
  const provisional = automaticNormalization(fromSQL('CREATE TABLE P(Id INT PRIMARY KEY, A INT);'));
  assert.ok(provisional.assumptions.some((a) => a.includes('Pueden faltar')));
  const missing = automaticNormalization(fromSQL('CREATE TABLE P(A INT, B INT);'));
  assert.match(missing.error!, /No hay PRIMARY KEY/);
  assert.equal(missing.stages.length, 0);
});

test('varias tablas: conserva una clave alternativa referenciada y reubica las FK entre resultados', () => {
  const sql =
    '-- @fd P: A -> Id\nCREATE TABLE P(Id INT PRIMARY KEY, A INT NOT NULL UNIQUE); CREATE TABLE H(Id INT PRIMARY KEY, PId INT REFERENCES P(Id));';
  const tables: ParsedTable[] = JSON.parse(
    execFileSync(sqlglotPython(), ['-X', 'utf8', 'python/sql_analysis.py'], {
      input: sql,
      encoding: 'utf8',
    }),
  ).tables;
  const results = tables.map((table) => automaticNormalization(table));
  assert.ok(results.every((result) => !result.error));
  const project = assembleProject(
    tables,
    new Map(results.map((result) => [result.source.name, result.stages[2].tables])),
  );
  assert.deepEqual(project.errors, []);
  assert.ok(project.tables.some((t) => t.foreignKeys.some((f) => f.table.startsWith('P_3FN'))));
  assert.equal(parseSQL(exportSQL(project.tables)).length, 2);
});
test('listas ambiguas y reglas contradichas bloquean resultados en lugar de certificar 1FN', () => {
  const lists = automaticNormalization(
    fromSQL(
      "CREATE TABLE P(Id INT PRIMARY KEY, Telefonos VARCHAR(40)); INSERT INTO P VALUES(1,'123;456');",
    ),
  );
  assert.match(lists.error!, /Posibles valores multivalor/);
  const contradiction = automaticNormalization(
    fromSQL(
      '-- @fd P: A -> B\nCREATE TABLE P(Id INT PRIMARY KEY, A INT, B INT); INSERT INTO P VALUES(1,2,3),(2,2,4);',
    ),
  );
  assert.match(contradiction.error!, /contradicen/);
});
