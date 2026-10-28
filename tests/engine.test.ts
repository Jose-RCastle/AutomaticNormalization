import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  parseSQL,
  parseDependencies,
  dependencies,
  analyze,
  normalize,
  closure,
  candidateKeys,
  cover,
  exportSQL,
  exportMermaid,
  firstNormalForm,
} from '../src/lib/normalization';
const table = parseSQL(readFileSync('examples/pedidos.sql', 'utf8'))[0];
const fds = dependencies(
  table,
  parseDependencies(
    'PedidoId -> ClienteId\nClienteId -> ClienteNombre\nProductoId -> ProductoNombre',
    table,
  ),
);
test('DDL: claves compuestas, tipos con comas y FK', () => {
  const ts = parseSQL(
    'CREATE TABLE [dbo].[Padre] ([Id] INT PRIMARY KEY, Precio DECIMAL(10,2) NOT NULL); CREATE TABLE Hija (Id INT PRIMARY KEY, PadreId INT, CONSTRAINT FK_P FOREIGN KEY (PadreId) REFERENCES [dbo].[Padre] ([Id]));',
  );
  assert.equal(ts[0].columns[1].type, 'DECIMAL(10,2)');
  assert.deepEqual(ts[0].primaryKey, ['Id']);
  assert.equal(ts[1].foreignKeys[0].table, 'dbo.Padre');
});
test('rechaza DDL incompleto y atributos desconocidos', () => {
  assert.throws(() => parseSQL('CREATE TABLE X (Id INT'));
  assert.deepEqual(
    parseSQL('CREATE TABLE X(Id INT); ALTER TABLE X ADD PRIMARY KEY(Id);')[0].primaryKey,
    ['Id'],
  );
  assert.throws(() => parseDependencies('Inexistente -> Cantidad', table));
});
test('claves candidatas y diagnóstico de dependencias parciales', () => {
  const r = analyze(table, fds, true);
  assert.equal(r.form, '1FN');
  assert.deepEqual(r.keys, [['PedidoId', 'ProductoId']]);
  assert.ok(r.partial.length > 0);
  assert.equal(analyze(table, fds, false).form, 'Sin confirmar 1FN');
});
test('una dependencia transitiva con clave simple se diagnostica en 2FN', () => {
  const t = parseSQL('CREATE TABLE T (A INT PRIMARY KEY, B INT, C INT)')[0];
  assert.equal(analyze(t, dependencies(t, [{ left: ['B'], right: ['C'] }]), true).form, '2FN');
});
test('3FN considera todos los atributos primos de claves alternativas', () => {
  const t = parseSQL('CREATE TABLE T (A INT, B INT, C INT, PRIMARY KEY(A,B))')[0];
  const fs = dependencies(t, [
    { left: ['C'], right: ['B'] },
    { left: ['B'], right: ['C'] },
  ]);
  assert.equal(candidateKeys(['A', 'B', 'C'], fs).length, 2);
  assert.equal(analyze(t, fs, true).form, '3FN');
});
test('2FN: elimina dependencias parciales de las relaciones generadas', () => {
  const out = normalize(table, fds, '2FN');
  assert.ok(out.length > 1);
  for (const t of out) {
    const attrs = t.columns.map((c) => c.name);
    const projected = [];
    for (let m = 1; m < 2 ** attrs.length; m++) {
      const left = attrs.filter((_, i) => m & (2 ** i));
      projected.push({ left, right: closure(left, fds).filter((a) => attrs.includes(a)) });
    }
    assert.equal(analyze(t, projected, true).partial.length, 0);
  }
});
test('3FN: preserva atributos y dependencias, incluye una clave para reunión sin pérdida', () => {
  const out = normalize(table, fds, '3FN');
  const attrs = table.columns.map((c) => c.name);
  assert.deepEqual(
    [...new Set(out.flatMap((t) => t.columns.map((c) => c.name)))].sort(),
    [...attrs].sort(),
  );
  const projected = [];
  for (const t of out) {
    const as = t.columns.map((c) => c.name);
    const local = [];
    for (let m = 1; m < 2 ** as.length; m++) {
      const left = as.filter((_, i) => m & (2 ** i));
      local.push({ left, right: closure(left, fds).filter((a) => as.includes(a)) });
    }
    assert.equal(analyze(t, local, true).form, '3FN');
    projected.push(...local);
  }
  for (const f of fds) assert.ok(f.right.every((a) => closure(f.left, projected).includes(a)));
  assert.ok(
    out.some((t) =>
      candidateKeys(attrs, fds).some((k) => k.every((a) => t.columns.some((c) => c.name === a))),
    ),
  );
});
test('cubierta mínima mantiene las clausuras', () => {
  const fs = [
    { left: ['A'], right: ['B', 'C'] },
    { left: ['B'], right: ['C'] },
    { left: ['A', 'B'], right: ['D'] },
  ];
  const min = cover(fs);
  for (const a of ['A', 'B', 'C', 'D'])
    assert.deepEqual(closure([a], fs).sort(), closure([a], min).sort());
});
test('1FN extrae grupos y conserva referencia al padre', () => {
  const t = parseSQL(
    'CREATE TABLE Contacto (Id INT PRIMARY KEY, Tel1 NVARCHAR(30), Tel2 NVARCHAR(30))',
  )[0];
  const [p, c] = firstNormalForm(t, ['Tel1', 'Tel2']);
  assert.equal(p.columns.length, 1);
  assert.deepEqual(c.primaryKey, ['Id', 'Posicion']);
  assert.equal(c.foreignKeys[0].table, 'Contacto');
  assert.equal(c.columns.at(-1)?.name, 'Valor');
  assert.throws(() => firstNormalForm(t, ['Id']));
});
test('exporta SQL de estructuras y un diagrama Mermaid', () => {
  const out = normalize(table, fds, '3FN');
  const sql = exportSQL(out);
  assert.match(sql, /CREATE TABLE/);
  assert.match(sql, /ALTER TABLE/);
  assert.match(exportMermaid(out), /^erDiagram/);
  assert.doesNotMatch(sql, /INSERT INTO/);
});
test('1FN: no duplica IDENTITY en la hija ni conserva UNIQUE sobre columnas eliminadas', () => {
  const [table] = parseSQL(
    'CREATE TABLE Contacto(Id INT IDENTITY(5,2) PRIMARY KEY, Tel1 VARCHAR(30) UNIQUE, Tel2 VARCHAR(30));',
  );
  const [parent, child] = firstNormalForm(table, ['Tel1', 'Tel2']);
  assert.equal(parent.columns[0].identity, 'IDENTITY(5,2)');
  assert.equal(child.columns[0].identity, undefined);
  assert.deepEqual(parent.uniqueKeys, []);
  assert.doesNotThrow(() => parseSQL(exportSQL([parent, child])));
});
