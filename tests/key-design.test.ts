import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dependencies } from '../src/lib/relational';
import { normalize } from '../src/lib/decomposition';
import { Table } from '../src/lib/models';

const relation = (names: string[], key: string[]): Table => ({
  name: 'R',
  columns: names.map((name) => ({ name, type: 'INT', nullable: false })),
  primaryKey: key,
  foreignKeys: [],
});

test('la clave de una entidad conserva el componente de la PK original aunque orden alfabético y orden de columnas favorezcan otra candidata', () => {
  const table = relation(['Alias', 'Project', 'Zkey', 'Location', 'Value'], ['Zkey', 'Project']);
  const rules = dependencies(table, [
    { left: ['Zkey'], right: ['Alias'] },
    { left: ['Alias'], right: ['Zkey'] },
    { left: ['Project'], right: ['Location'] },
  ]);
  const result = normalize(table, rules, '3FN');
  const entity = result.find((t) => t.columns.some((c) => c.name === 'Alias'))!;
  assert.deepEqual(entity.primaryKey, ['Zkey']);
  assert.ok(entity.uniqueKeys?.some((k) => k.join(',') === 'Alias'));
  const link = result.find((t) => t.columns.some((c) => c.name === 'Value'))!;
  assert.ok(
    link.foreignKeys.some((f) => f.table === entity.name && f.references.join(',') === 'Zkey'),
  );
});

test('una relación sintetizada puede referenciar UNIQUE si la PK de destino no está presente', () => {
  const table = relation(['A', 'B', 'C', 'D', 'E'], ['C', 'D']);
  const rules = dependencies(table, [
    { left: ['A'], right: ['B'] },
    { left: ['B'], right: ['A'] },
    { left: ['C'], right: ['B'] },
    { left: ['D'], right: ['E'] },
  ]);
  const result = normalize(table, rules, '3FN');
  const entity = result.find((t) => t.columns.some((c) => c.name === 'A'))!;
  assert.deepEqual(entity.primaryKey, ['A']);
  const referencing = result.find(
    (t) => t.columns.some((c) => c.name === 'C') && t.columns.some((c) => c.name === 'B'),
  )!;
  assert.ok(entity.uniqueKeys?.some((k) => k.join(',') === 'B'));
  assert.ok(
    referencing.foreignKeys.some((f) => f.table === entity.name && f.references.join(',') === 'B'),
  );
});

test('una tabla ya normalizada conserva nombre, clave y metadatos sin mutar la entrada', () => {
  const table = relation(['Id', 'Name'], ['Id']);
  table.sqlName = ['sales', 'R'];
  table.name = 'sales.R';
  const before = structuredClone(table);
  for (const target of ['2FN', '3FN'] as const) {
    const [result] = normalize(table, dependencies(table, []), target);
    assert.deepEqual(result, table);
    assert.notEqual(result, table);
  }
  assert.deepEqual(table, before);
});
