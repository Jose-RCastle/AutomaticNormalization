import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  analyze,
  AnalysisLimitError,
  candidateKeys,
  closure,
  dependencies,
  FD,
  normalize,
  projection,
  Table,
} from '../src/lib/normalization';

const subsets = (attrs: string[]) =>
  Array.from({ length: 2 ** attrs.length }, (_, mask) => attrs.filter((_, i) => mask & (2 ** i)));
const contained = (a: string[], b: string[]) => a.every((value) => b.includes(value));
function exhaustiveKeys(attrs: string[], rules: FD[]) {
  const superkeys = subsets(attrs).filter((left) => contained(attrs, closure(left, rules)));
  return superkeys.filter(
    (key) => !superkeys.some((other) => other.length < key.length && contained(other, key)),
  );
}
// El chase contrasta reunión sin pérdida sin depender del algoritmo de síntesis.
function lossless(attrs: string[], groups: string[][], rules: FD[]) {
  const rows = groups.map((group, i) =>
    attrs.map((a) => (group.includes(a) ? `a:${a}` : `b:${i}:${a}`)),
  );
  const parent = new Map<string, string>();
  const root = (s: string): string => (parent.has(s) ? root(parent.get(s)!) : s);
  let changed = true;
  while (changed) {
    changed = false;
    for (const rule of rules)
      for (const a of rows)
        for (const b of rows) {
          if (
            !rule.left.every(
              (name) => root(a[attrs.indexOf(name)]) === root(b[attrs.indexOf(name)]),
            )
          )
            continue;
          for (const name of rule.right) {
            const x = root(a[attrs.indexOf(name)]),
              y = root(b[attrs.indexOf(name)]);
            if (x !== y) {
              if (x.startsWith('a:')) parent.set(y, x);
              else parent.set(x, y);
              changed = true;
            }
          }
        }
  }
  return rows.some((row) => attrs.every((name, i) => root(row[i]) === root(`a:${name}`)));
}
let seed = 9127;
const random = () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 2 ** 32;
};

test('claves y diagnóstico coinciden con un oráculo exhaustivo en 100 casos', () => {
  const attrs = ['A', 'B', 'C', 'D', 'E'];
  for (let n = 0; n < 100; n++) {
    const rules: FD[] = Array.from({ length: 6 }, () => ({
      left: attrs.filter(() => random() < 0.3),
      right: [attrs[Math.floor(random() * attrs.length)]],
    })).filter((f) => f.left.length);
    const expected = exhaustiveKeys(attrs, rules),
      actual = candidateKeys(attrs, rules);
    const signature = (keys: string[][]) => keys.map((k) => [...k].sort().join(',')).sort();
    assert.deepEqual(signature(actual), signature(expected));
    const table: Table = {
      name: 'R',
      columns: attrs.map((name) => ({ name, type: 'INT', nullable: false })),
      primaryKey: actual[0],
      foreignKeys: [],
    };
    const nonprime = attrs.filter((a) => !expected.flat().includes(a));
    const violations = subsets(attrs).filter(
      (left) =>
        !contained(attrs, closure(left, rules)) &&
        closure(left, rules).some((a) => !left.includes(a) && nonprime.includes(a)),
    );
    const partial = violations.some((left) =>
      expected.some((key) => left.length < key.length && contained(left, key)),
    );
    const report = analyze(table, rules, true);
    assert.equal(report.form, partial ? '1FN' : violations.length ? '2FN' : '3FN');
  }
});
test('2FN/3FN: proyección exacta, reunión sin pérdida y preservación de dependencias', () => {
  const attrs = ['A', 'B', 'C', 'D', 'E'];
  for (let n = 0; n < 35; n++) {
    const table: Table = {
      name: 'R',
      columns: attrs.map((name) => ({ name, type: 'INT', nullable: false })),
      primaryKey: ['A', 'B'],
      foreignKeys: [],
    };
    const fs = dependencies(
      table,
      Array.from({ length: 4 }, () => ({
        left: attrs.filter(() => random() < 0.3),
        right: [attrs[Math.floor(random() * attrs.length)]],
      })).filter((f) => f.left.length),
    );
    for (const target of ['2FN', '3FN'] as const) {
      const result = normalize(table, fs, target),
        groups = result.map((t) => t.columns.map((c) => c.name));
      assert.ok(lossless(attrs, groups, fs), `${target} pierde información`);
      const projected = result.flatMap((t) => {
        const group = t.columns.map((c) => c.name),
          p = projection(group, fs);
        for (const left of subsets(group))
          assert.deepEqual(
            closure(left, p).sort(),
            closure(left, fs)
              .filter((a) => group.includes(a))
              .sort(),
          );
        const report = analyze(t, p, true);
        assert.equal(report.partial.length, 0);
        if (target === '3FN') assert.equal(report.form, '3FN');
        return p;
      });
      if (target === '3FN')
        for (const f of fs) assert.ok(contained(f.right, closure(f.left, projected)));
    }
  }
});
test('una tabla de 120 columnas con clave simple no necesita enumerar 2^120 subconjuntos', () => {
  const table: Table = {
    name: 'Amplia',
    columns: Array.from({ length: 120 }, (_, i) => ({
      name: `C${i}`,
      type: 'INT',
      nullable: false,
    })),
    primaryKey: ['C0'],
    foreignKeys: [],
  };
  const fs = dependencies(table, []);
  assert.equal(analyze(table, fs, true).form, '3FN');
  assert.equal(normalize(table, fs, '3FN')[0].columns.length, 120);
});
test('el límite de combinaciones aborta un caso patológico sin devolver claves parciales', () => {
  const attrs = Array.from({ length: 16 }, (_, i) => [`A${i}`, `B${i}`]).flat();
  const fs = Array.from({ length: 16 }, (_, i) => [
    { left: [`A${i}`], right: [`B${i}`] },
    { left: [`B${i}`], right: [`A${i}`] },
  ]).flat();
  assert.throws(() => candidateKeys(attrs, fs), AnalysisLimitError);
});
test('dependencias con nombres que contienen comas, flechas o corchetes', async () => {
  const { parseSQL, parseDependencies } = await import('../src/lib/normalization');
  const [table] = parseSQL(
    'CREATE TABLE T([Id] INT PRIMARY KEY, [Nombre, apellido] NVARCHAR(80), [Texto->valor] INT)',
  );
  assert.deepEqual(parseDependencies('[Id] -> [Nombre, apellido], [Texto->valor]', table), [
    { left: ['Id'], right: ['Nombre, apellido', 'Texto->valor'] },
  ]);
});
