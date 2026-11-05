import { test } from 'node:test';
import assert from 'node:assert/strict';
import { automaticNormalization, ParsedTable } from '../src/lib/automatic';
import { recommendedRules } from '../src/lib/review';
import { relationshipProblems, relationshipWarnings, verifyJoin } from '../src/lib/validation';
import { exportSQL } from '../src/lib/exporters';
import { assembleProject } from '../src/lib/project';
const table = (names: string[], key: string[]): ParsedTable => ({
  name: 'R',
  columns: names.map((name) => ({ name, type: 'INT', nullable: false })),
  primaryKey: key,
  foreignKeys: [],
});
test('DDL solo no se certifica como 3FN; las reglas de negocio se pueden confirmar explícitamente', () => {
  const input = table(['A', 'B'], ['A']);
  assert.match(automaticNormalization(input).form, /No se puede determinar/);
  input.review = { rulesComplete: true, atomicConfirmed: true };
  assert.deepEqual(automaticNormalization(input).pending, []);
});
test('las dependencias compuestas de la muestra no intervienen sin aprobación', () => {
  const input = table(['Id', 'A', 'B', 'C'], ['Id']);
  input.profile = {
    rowCount: 6,
    nulls: {},
    duplicateRows: 0,
    search: '',
    observedRules: [{ left: ['A', 'B'], right: ['C'] }],
  };
  const result = automaticNormalization(input);
  assert.equal(
    result.rules.some((f) => f.left.includes('A') && f.left.includes('B')),
    false,
  );
  assert.equal(result.stages[2].tables.length, 1);
  assert.ok(result.suggestedRules.length);
});
test('equivalencia en una muestra no activa UNIQUE inversos ni ciclos', () => {
  const input = table(['Id', 'Code', 'Label'], ['Id']);
  input.profile = {
    rowCount: 6,
    nulls: {},
    duplicateRows: 0,
    search: '',
    observedRules: [
      { left: ['Code'], right: ['Label'] },
      { left: ['Label'], right: ['Code'] },
    ],
  };
  const proposals = recommendedRules(input, input.profile.observedRules);
  assert.deepEqual(
    proposals.map((f) => f.left),
    [['Code']],
  );
  const result = automaticNormalization(input);
  assert.ok(result.pending.some((p) => p.includes('sin confirmar')));
  assert.ok(
    result.stages[2].tables.every((t) => !(t.uniqueKeys || []).some((k) => k.includes('Label'))),
  );
});
test('FK cíclicas válidas avisan sobre la carga; las duplicadas impiden exportar', () => {
  const a = table(['Id', 'Other'], ['Id']),
    b = { ...table(['Id', 'Other'], ['Id']), name: 'B' };
  a.foreignKeys = [{ columns: ['Other'], table: 'B', references: ['Id'] }];
  b.foreignKeys = [{ columns: ['Other'], table: 'R', references: ['Id'] }];
  assert.ok(relationshipWarnings([a, b]).some((p) => p.includes('Ciclo')));
  assert.deepEqual(relationshipProblems([a, b]), []);
  assert.doesNotThrow(() => exportSQL([a, b]));
  a.foreignKeys.push(structuredClone(a.foreignKeys[0]));
  assert.throws(() => exportSQL([a, b]), /duplicada/);
  a.foreignKeys.pop();
  b.foreignKeys = [];
  const sql = exportSQL([a, b], { schema: 'norm' });
  assert.match(sql, /CREATE TABLE \[norm\]\.\[R\]/);
  assert.match(sql, /CONSTRAINT \[FK_R_B_1\]/);
  assert.match(sql, /OBJECT_ID/);
  assert.equal(a.name, 'R');
});
test('la reunión detecta tuplas espurias, preserva muestras válidas y limita productos cartesianos', () => {
  const rows = [
    { A: '1', B: 'x', C: 'q' },
    { A: '2', B: 'x', C: 'r' },
  ];
  assert.equal(
    verifyJoin(rows, [table(['A', 'B'], ['A']), table(['B', 'C'], ['B'])], ['A', 'B', 'C']).status,
    'failed',
  );
  assert.equal(
    verifyJoin(rows, [table(['A', 'B'], ['A']), table(['A', 'C'], ['A'])], ['A', 'B', 'C']).status,
    'passed',
  );
});
test('FK original se reubica cuando el padre se descompone; CHECK DEFAULT IDENTITY se conservan', () => {
  const parent = table(['Id', 'GroupId', 'Label'], ['Id']);
  parent.columns[0].identity = 'IDENTITY(5,2)';
  parent.columns[2].default = '9';
  parent.checks = [{ expression: 'GroupId > 0', columns: ['GroupId'] }];
  parent.rules = ['GroupId -> Label'];
  parent.review = { atomicConfirmed: true };
  const child = { ...table(['Id', 'ParentId'], ['Id']), name: 'Child' };
  child.foreignKeys = [{ columns: ['ParentId'], table: 'R', references: ['Id'] }];
  child.review = { atomicConfirmed: true, rulesComplete: true };
  const results = [parent, child].map(automaticNormalization);
  const project = assembleProject(
    [parent, child],
    new Map(results.map((r) => [r.source.name, r.stages[2].tables])),
  );
  assert.deepEqual(project.errors, []);
  const ddl = exportSQL(project.tables, { schema: 'norm' });
  assert.match(ddl, /IDENTITY\(5,2\)/);
  assert.match(ddl, /DEFAULT 9/);
  assert.match(ddl, /CHECK \(GroupId > 0\)/);
  const ref = project.tables.find((t) => t.name === 'Child')!.foreignKeys[0];
  assert.notEqual(ref.table, 'R');
});
