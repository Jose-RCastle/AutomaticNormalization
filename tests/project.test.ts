import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assembleProject } from '../src/lib/project';
import { Table } from '../src/lib/models';
import { exportSQL } from '../src/lib/exporters';
import { parseSQL } from '../src/lib/normalization';

const entity = (name: string, names = ['Id']): Table => ({
  name,
  columns: names.map((name) => ({ name, type: 'INT', nullable: false })),
  primaryKey: ['Id'],
  foreignKeys: [],
});
const sources = () => {
  const parent = entity('Padre', ['Id', 'Nombre']);
  const child = entity('Hijo', ['Id', 'PadreId']);
  child.foreignKeys.push({ columns: ['PadreId'], table: 'Padre', references: ['Id'] });
  return [parent, child];
};
test('el proyecto conserva tablas pendientes y referencias, sin modificar entradas', () => {
  const original = sources(),
    before = structuredClone(original);
  const model = assembleProject(original, new Map());
  assert.equal(model.completed, 0);
  assert.equal(model.warnings.length, 2);
  assert.deepEqual(model.errors, []);
  assert.equal(model.tables[1].foreignKeys[0].table, 'Padre');
  assert.deepEqual(original, before);
});
test('reubica una FK externa al único resultado con la clave referenciada y exporta SQL reimportable', () => {
  const model = assembleProject(
    sources(),
    new Map([['Padre', [entity('Padre_3FN_1', ['Id', 'Nombre'])]]]),
  );
  assert.equal(model.completed, 1);
  assert.deepEqual(model.errors, []);
  assert.equal(model.tables[1].foreignKeys[0].table, 'Padre_3FN_1');
  const imported = parseSQL(exportSQL(model.tables));
  assert.equal(imported.length, 2);
  assert.equal(imported[1].foreignKeys[0].table, 'Padre_3FN_1');
});
test('bloquea referencias ambiguas, destinos ausentes y nombres duplicados', () => {
  const original = sources();
  const ambiguous = assembleProject(original, new Map([['Padre', [entity('P1'), entity('P2')]]]));
  assert.ok(ambiguous.errors.some((error) => error.includes('inequívoca')));
  const missing = assembleProject(original, new Map([['Padre', [entity('P', ['Nombre'])]]]));
  assert.ok(missing.errors.length);
  const duplicate = assembleProject(original, new Map([['Padre', [entity('Hijo')]]]));
  assert.ok(duplicate.errors.some((error) => error.includes('duplicado')));
});
