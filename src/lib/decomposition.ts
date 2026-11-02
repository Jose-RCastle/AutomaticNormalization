import { FD, Table } from './models';
import { analyze, candidateKeys, cover, projection, subset, unique } from './relational';

/** Síntesis 3FN por cubierta mínima, o descomposición binaria para 2FN. */
export function normalize(
  table: Table,
  rules: FD[],
  target: '2FN' | '3FN',
  nulls: Record<string, number> = {},
): Table[] {
  if (table.issues?.length) throw Error(table.issues.join(' '));
  const attributes = table.columns.map((c) => c.name);
  const diagnosis = analyze(table, rules, true);
  if (!diagnosis.partial.length && (target === '2FN' || !diagnosis.transitive.length))
    return [structuredClone(table)];
  let groups: string[][];
  const generators: FD[] = [];
  if (target === '3FN') {
    const grouped = new Map<string, string[]>();
    for (const rule of cover(rules)) {
      generators.push(rule);
      const determinant = [...rule.left].sort().join('\0');
      grouped.set(determinant, unique([...(grouped.get(determinant) || rule.left), ...rule.right]));
    }
    groups = [...grouped.values()];
    const keys = candidateKeys(attributes, rules);
    // Incluir una clave asegura una reunión sin pérdida en la síntesis 3FN.
    if (!groups.some((group) => keys.some((key) => subset(key, group)))) groups.push(keys[0]);
    groups = groups.filter(
      (group, i) =>
        !groups.some(
          (other, j) => i !== j && subset(group, other) && (group.length < other.length || j < i),
        ),
    );
  } else {
    groups = [attributes];
    for (let i = 0; i < groups.length; i++) {
      const group = groups[i],
        local = projection(group, rules);
      const relation = { ...table, columns: table.columns.filter((c) => group.includes(c.name)) };
      const violation = analyze(relation, local, true).partial[0];
      if (violation) {
        generators.push(violation);
        groups.splice(
          i,
          1,
          unique([...violation.left, ...violation.right]),
          group.filter((a) => !violation.right.includes(a)),
        );
        i--;
      }
    }
  }
  // Non-null keys are represented by FDs and preserved by synthesis. Nullable UNIQUE
  // constraints are SQL constraints outside classical FD semantics and must be retained explicitly.
  const originalKeys = (table.uniqueKeys || []).filter((k) =>
    k.some((n) => table.columns.find((c) => c.name === n)?.nullable),
  );
  for (const key of originalKeys)
    if (!groups.some((g) => subset(key, g)))
      throw Error(
        `La restricción UNIQUE (${key.join(', ')}) abarca varias relaciones. Se conserva la etapa anterior hasta resolver esta restricción.`,
      );
  for (const check of table.checks || [])
    if (!groups.some((g) => subset(check.columns, g)))
      throw Error(
        `CHECK (${check.expression}) abarca varias relaciones; necesita una restricción entre tablas antes de exportar esta etapa.`,
      );
  let identityOwner = groups.findIndex((g) => subset(table.primaryKey, g));
  if (identityOwner < 0)
    identityOwner = groups.findIndex((g) =>
      table.columns.some((c) => c.identity && g.includes(c.name)),
    );
  const result: Table[] = groups.map((group, i) => {
    const keys = candidateKeys(group, projection(group, rules));
    const same = (a: string[], b: string[]) => a.length === b.length && subset(a, b);
    // A key is a design choice among mathematically valid candidates. Preserve
    // provenance; candidateKeys' alphabetical display order must not decide it.
    const generating = generators
      .filter((f) => subset([...f.left, ...f.right], group))
      .map((f) => f.left);
    const original = [
      table.primaryKey,
      ...(table.uniqueKeys || []).filter((k) =>
        k.every((n) => !table.columns.find((c) => c.name === n)?.nullable),
      ),
    ];
    const eligible = (key: string[]) =>
      key.every(
        (n) =>
          !nulls[n] &&
          !/\(\s*MAX\s*\)|^(TEXT|NTEXT|IMAGE|XML|JSON|GEOGRAPHY|GEOMETRY|CALCULADA)$/i.test(
            table.columns.find((c) => c.name === n)!.type,
          ),
      );
    const idLike = (n: string) =>
      /^(?:id|cod|code|num|key)(?:_|[A-Z]|$)/.test(n) ||
      /^(?:id|cod|code|num|key)_/i.test(n) ||
      /(?:id|number|ssn)$/i.test(n);
    const rank = (key: string[]) => [
      original.some((k) => same(k, key)) ? 0 : 1,
      -key.filter((n) => table.primaryKey.includes(n)).length,
      generating.some((k) => same(k, key)) ? 0 : 1,
      key.every((n) => idLike(n)) ? 0 : 1,
      key.every((n) => !table.columns.find((c) => c.name === n)?.nullable) ? 0 : 1,
      key.length,
      ...key.map((n) => attributes.indexOf(n)).sort((a, b) => a - b),
    ];
    const ranked = [...keys].sort((a, b) => {
      const ar = rank(a),
        br = rank(b);
      for (let j = 0; j < Math.max(ar.length, br.length); j++)
        if ((ar[j] || 0) !== (br[j] || 0)) return (ar[j] || 0) - (br[j] || 0);
      return 0;
    });
    const primaryKey = ranked.find(eligible) || ranked[0];
    const invalid = primaryKey.filter((n) => nulls[n]);
    if (invalid.length)
      throw Error(
        `No se puede crear una clave en ${invalid.join(', ')}: contiene NULL. La dependencia no permite reconstruir esos registros. Corrige su significado o los datos; se conserva la etapa anterior.`,
      );
    const unindexable = primaryKey.filter((n) =>
      /\(\s*MAX\s*\)|^(TEXT|NTEXT|IMAGE|XML|JSON|GEOGRAPHY|GEOMETRY|CALCULADA)$/i.test(
        table.columns.find((c) => c.name === n)!.type,
      ),
    );
    if (unindexable.length)
      throw Error(
        `SQL Server no puede usar ${unindexable.join(', ')} como clave con su tipo actual. Define un tipo indexable antes de exportar esta etapa.`,
      );
    const keyLabel = primaryKey.join('_').replace(/[^\p{L}\p{N}_]/gu, '_');
    const name = `${(table.sqlName?.at(-1) || table.name.replace(/\./g, '_')).slice(0, 60)}_${target}_${keyLabel.slice(0, 40)}_${i + 1}`;
    const sqlName = [...(table.sqlName?.slice(0, -1) || []), name];
    const localKeys = [
      ...keys.filter((k) => k !== primaryKey),
      ...(table.uniqueKeys || []).filter((k) => subset(k, group)),
    ];
    const uniqueKeys = localKeys.filter(
      (k, index) =>
        !(k.length === primaryKey.length && subset(k, primaryKey)) &&
        !localKeys.slice(0, index).some((other) => other.length === k.length && subset(k, other)),
    );
    const columns = table.columns
      .filter((c) => group.includes(c.name))
      .map((c) => {
        const copy = structuredClone(c);
        if (i !== identityOwner) delete copy.identity;
        if (copy.computed && !subset(copy.expressionColumns || [], group))
          throw Error(
            `La expresión de ${copy.name} necesita columnas que quedaron en otra tabla. No se ha eliminado la expresión.`,
          );
        return copy;
      });
    return {
      name: sqlName.join('.'),
      sqlName,
      origin: table.origin || table.name,
      columns,
      primaryKey,
      uniqueKeys,
      foreignKeys: [],
      checks: (table.checks || []).filter((c) => subset(c.columns, group)),
      warnings: primaryKey
        .filter((n) => table.columns.find((c) => c.name === n)?.nullable)
        .map(
          (n) =>
            `${n}: la nueva clave requiere NOT NULL; verifica la totalidad de los datos antes de migrar.`,
        ),
    };
  });
  for (const relation of result) {
    relation.columns.forEach((c) => {
      if (relation.primaryKey.includes(c.name)) c.nullable = false;
    });
    for (const other of result) {
      if (relation === other) continue;
      const reference = [other.primaryKey, ...(other.uniqueKeys || [])].find(
        (key) =>
          key.length &&
          subset(
            key,
            relation.columns.map((c) => c.name),
          ),
      );
      if (reference) {
        relation.foreignKeys.push({
          columns: reference,
          table: other.name,
          references: reference,
        });
      }
    }
  }
  return result;
}
