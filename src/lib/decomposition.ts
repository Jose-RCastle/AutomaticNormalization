import { FD, Table } from './models';
import { analyze, candidateKeys, cover, projection, subset, unique } from './relational';

/** Síntesis 3FN por cubierta mínima, o descomposición binaria para 2FN. */
export function normalize(table: Table, rules: FD[], target: '2FN' | '3FN'): Table[] {
  if (table.issues?.length) throw Error(table.issues.join(' '));
  const attributes = table.columns.map((c) => c.name);
  let groups: string[][];
  if (target === '3FN') {
    const grouped = new Map<string, string[]>();
    for (const rule of cover(rules)) {
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
  const result: Table[] = groups.map((group, i) => ({
    name: `${table.name.replace(/\./g, '_').slice(0, 100)}_${target}_${i + 1}`,
    columns: table.columns
      .filter((c) => group.includes(c.name))
      .map((c) => ({ name: c.name, type: c.type, nullable: c.nullable })),
    primaryKey: candidateKeys(group, projection(group, rules))[0],
    foreignKeys: [],
  }));
  for (const relation of result) {
    relation.columns.forEach((c) => {
      if (relation.primaryKey.includes(c.name)) c.nullable = false;
    });
    for (const other of result)
      if (
        relation !== other &&
        other.primaryKey.length &&
        subset(
          other.primaryKey,
          relation.columns.map((c) => c.name),
        )
      ) {
        relation.foreignKeys.push({
          columns: other.primaryKey,
          table: other.name,
          references: other.primaryKey,
        });
      }
  }
  return result;
}
