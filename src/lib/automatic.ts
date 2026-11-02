import { FD, Table } from './models';
import { analyze, dependencies, parseDependencies, projection, candidateKeys } from './relational';
import { normalize } from './decomposition';
import { numberedNormalForm } from './first-normal-form';

export interface ParsedTable extends Table {
  warnings?: string[];
  rules?: string[];
  profile?: {
    rowCount: number;
    totalRows?: number;
    sampled?: boolean;
    searchLimited?: boolean;
    nulls: Record<string, number>;
    duplicateRows: number;
    possibleLists?: string[];
    listCandidates?: { column: string; kind: string; separator: string }[];
    observedRules: FD[];
    search: string;
  };
}
export interface AutomaticResult {
  source: ParsedTable;
  form: string;
  assumptions: string[];
  rules: FD[];
  stages: { label: string; explanation: string; tables: Table[]; error?: string }[];
  diagnosis: ReturnType<typeof analyze> | null;
  error?: string;
}

/** Orquesta pasos pequeños; los algoritmos relacionales se conservan y prueban aparte. */
export function automaticNormalization(source: ParsedTable): AutomaticResult {
  const assumptions = [
    'La semántica y atomicidad de los valores no se pueden demostrar con DDL. La propuesta supone valores atómicos fuera de los grupos detectados.',
  ];
  const result: AutomaticResult = {
    source,
    form: 'No determinada',
    assumptions,
    rules: [],
    stages: [],
    diagnosis: null,
  };
  try {
    if (source.issues?.length) throw Error(source.issues.join(' '));
    const table = structuredClone(source);
    const hasUsableKey =
      source.primaryKey.length > 0 ||
      (source.uniqueKeys || []).some(
        (k) => k.length && k.every((n) => source.columns.some((c) => c.name === n && !c.nullable)),
      );
    table.origin = source.name;
    if (table.profile?.possibleLists?.length)
      assumptions.push(
        `Texto con separadores en ${table.profile.possibleLists.join(', ')}: se conserva como valor escalar. Una coma en una dirección no demuestra que exista una lista.`,
      );
    for (const candidate of table.profile?.listCandidates || [])
      assumptions.push(
        `Posible multivalor en ${candidate.column}: los elementos separados por «${candidate.separator}» tienen patrón de ${candidate.kind}. La atomicidad necesita revisión; no se han separado automáticamente.`,
      );
    if (!table.primaryKey.length) {
      const key = table.uniqueKeys?.find((key) =>
        key.every((name) => table.columns.some((c) => c.name === name && !c.nullable)),
      );
      if (key) table.primaryKey = key;
      else {
        let name = '__RowId';
        while (table.columns.some((c) => c.name.toLowerCase() === name.toLowerCase())) name += '_';
        table.columns.unshift({ name, type: 'BIGINT', nullable: false, identity: 'IDENTITY(1,1)' });
        table.primaryKey = [name];
        assumptions.push(
          `Sin clave declarada: se propone ${name}, una clave técnica IDENTITY. No se ha supuesto que las filas de la muestra constituyan una clave de negocio.`,
        );
      }
    }
    const declared = parseDependencies((table.rules || []).join('\n'), table);
    const empirical = table.profile?.observedRules || [];
    if (empirical.length && !declared.length)
      assumptions.push(
        'Dependencias descubiertas en los INSERT: hipótesis de la muestra, no reglas universales. Revisa la propuesta antes de aplicarla.',
      );
    if (!declared.length && !empirical.length)
      assumptions.push(
        'Solo hay dependencias de claves declaradas. Pueden faltar dependencias parciales o transitivas del negocio.',
      );
    // Keep declared semantics authoritative when present; observed rules remain visible in the profile.
    const effective = declared.length ? declared : empirical;
    result.rules = dependencies(table, effective);
    const groups = new Map<string, string[]>();
    for (const column of table.columns) {
      const match = column.name.match(/^(.*?)[_]?\d+$/);
      if (match && !table.primaryKey.includes(column.name)) {
        const signature = match[1].toLowerCase() + ':' + column.type;
        groups.set(signature, [...(groups.get(signature) || []), column.name]);
      }
    }
    let parent: Table = table;
    const children: Table[] = [];
    const bundles = new Map<string, { name: string; columns: string[] }[]>();
    for (const group of [...groups.values()].filter((g) => g.length > 1)) {
      const fkShapes = group.map((n) =>
        JSON.stringify(
          table.foreignKeys
            .filter((f) => f.columns.includes(n))
            .map((f) => ({
              table: f.table,
              references: f.references,
              onDelete: f.onDelete,
              onUpdate: f.onUpdate,
            }))
            .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
        ),
      );
      const constrained =
        new Set(fkShapes).size > 1 ||
        effective.some((f) => [...f.left, ...f.right].some((n) => group.includes(n))) ||
        (table.uniqueKeys || []).some((k) => k.some((n) => group.includes(n))) ||
        (table.checks || []).some((c) => c.columns.some((n) => group.includes(n))) ||
        table.columns.some(
          (c) => group.includes(c.name) && (c.computed || c.default || c.identity),
        );
      const name = group[0].replace(/[_]?\d+$/, '');
      if (constrained || table.primaryKey.includes(name)) {
        assumptions.push(
          `Se conservan ${group.join(', ')}: extraerlas automáticamente alteraría reglas o restricciones. La numeración por sí sola no prueba un atributo multivalor.`,
        );
        continue;
      }
      group.sort((a, b) => Number(a.match(/\d+$/)![0]) - Number(b.match(/\d+$/)![0]));
      const positions = group.map((n) => n.match(/\d+$/)![0]).join(',');
      bundles.set(positions, [...(bundles.get(positions) || []), { name, columns: group }]);
    }
    for (const bundle of bundles.values()) {
      const group = bundle.flatMap((g) => g.columns);
      const [next, child] = numberedNormalForm(parent, bundle);
      if (children.some((c) => c.name === child.name)) child.name += '_' + (children.length + 1);
      children.push(child);
      parent = next;
      assumptions.push(
        `Grupo supuesto por numeración y tipo: ${group.join(', ')}. Se extrae a ${child.name}; las columnas con la misma posición permanecen juntas. Revisa el significado del grupo.`,
      );
    }
    const rules = projection(
      parent.columns.map((c) => c.name),
      result.rules,
    );
    result.diagnosis = analyze(parent, rules, true);
    result.form = children.length
      ? 'No normalizada (grupo repetido supuesto)'
      : !hasUsableKey
        ? 'Prerrequisitos pendientes (sin clave declarada)'
        : table.profile?.listCandidates?.length
          ? 'Sin confirmar 1FN (posible multivalor)'
          : result.diagnosis.form + ' bajo las reglas disponibles';
    result.stages.push({
      label: '1FN',
      explanation: children.length
        ? 'Se extraen grupos repetidos; la clave hija se amplía con Posicion. No se dividen listas ni se migran filas.'
        : 'Se conserva la estructura; la atomicidad es un supuesto explícito.',
      tables: [parent, ...children],
    });
    for (const target of ['2FN', '3FN'] as const) {
      try {
        const tables = normalize(parent, rules, target, table.profile?.nulls);
        // Conservar las FK externas; assembleProject las resolverá sobre el conjunto completo.
        for (const relation of tables) {
          for (const foreign of parent.foreignKeys)
            if (
              foreign.columns.every((name) => relation.columns.some((c) => c.name === name)) &&
              !relation.foreignKeys.some((f) => JSON.stringify(f) === JSON.stringify(foreign))
            )
              relation.foreignKeys.push(foreign);
        }
        const remaining = children.map((child) => {
          const copy = structuredClone(child);
          const owner = tables.find((t) =>
            [t.primaryKey, ...(t.uniqueKeys || [])].some(
              (k) =>
                k.length === parent.primaryKey.length &&
                parent.primaryKey.every((name) => k.includes(name)),
            ),
          );
          if (!owner)
            throw Error('No se puede reubicar la clave del grupo repetido sin ambigüedad.');
          copy.foreignKeys = [
            { columns: parent.primaryKey, table: owner.name, references: parent.primaryKey },
          ];
          return copy;
        });
        // Comprobar la forma obtenida con todas las claves, no solo la principal.
        for (const relation of tables) {
          const local = projection(
            relation.columns.map((c) => c.name),
            rules,
          );
          if (
            !candidateKeys(
              relation.columns.map((c) => c.name),
              local,
            ).length
          )
            throw Error('No se pudo determinar una clave resultante.');
          const checked = analyze(relation, local, true);
          if (checked.partial.length || (target === '3FN' && checked.transitive.length))
            throw Error('La descomposición no pasó la verificación de forma normal.');
        }
        result.stages.push({
          label: target,
          explanation:
            target === '2FN'
              ? 'Elimina dependencias parciales de atributos no primos respecto de todas las claves candidatas mediante divisiones sin pérdida.'
              : 'Síntesis con cubierta mínima e inclusión de una clave: preserva dependencias y permite reunión sin pérdida bajo las reglas disponibles.',
          tables: [...tables, ...remaining],
        });
      } catch (error) {
        result.stages.push({
          label: target,
          explanation: 'Esta etapa necesita resolver una restricción antes de exportar.',
          tables: [],
          error: (error as Error).message,
        });
      }
    }
  } catch (error) {
    result.error = (error as Error).message;
    result.stages = [];
  }
  return result;
}
