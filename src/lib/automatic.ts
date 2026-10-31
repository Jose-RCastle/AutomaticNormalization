import { FD, Table } from './models';
import { analyze, dependencies, parseDependencies, projection, candidateKeys } from './relational';
import { normalize } from './decomposition';
import { firstNormalForm } from './first-normal-form';

export interface ParsedTable extends Table {
  warnings?: string[];
  rules?: string[];
  profile?: {
    rowCount: number;
    nulls: Record<string, number>;
    duplicateRows: number;
    possibleLists?: string[];
    observedRules: FD[];
    search: string;
  };
}
export interface AutomaticResult {
  source: ParsedTable;
  form: string;
  assumptions: string[];
  rules: FD[];
  stages: { label: string; explanation: string; tables: Table[] }[];
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
    if (table.profile?.possibleLists?.length)
      throw Error(
        `Posibles valores multivalor en ${table.profile.possibleLists.join(', ')}. No se separan cadenas por comas sin saber si son listas, direcciones o texto. Aclara el dominio o proporciona atributos atómicos para continuar.`,
      );
    if (!table.primaryKey.length) {
      const key = table.uniqueKeys?.find((key) =>
        key.every((name) => table.columns.some((c) => c.name === name && !c.nullable)),
      );
      if (!key)
        throw Error(
          'No hay PRIMARY KEY ni UNIQUE NOT NULL. No se inventó una clave a partir de una muestra; agrega una clave al SQL para transformar esta tabla.',
        );
      table.primaryKey = key;
    }
    const declared = parseDependencies((table.rules || []).join('\n'), table);
    const empirical = declared.length ? [] : table.profile?.observedRules || [];
    if (empirical.length)
      assumptions.push(
        'Dependencias descubiertas en los INSERT: hipótesis de la muestra, no reglas universales. Revisa la propuesta antes de aplicarla.',
      );
    if (!declared.length && !empirical.length)
      assumptions.push(
        'Solo hay dependencias de claves declaradas. Pueden faltar dependencias parciales o transitivas del negocio.',
      );
    result.rules = dependencies(table, [...declared, ...empirical]);
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
    for (const group of [...groups.values()].filter((group) => group.length > 1)) {
      if (
        result.rules.some((rule) =>
          [...rule.left, ...rule.right].some((name) => group.includes(name)),
        )
      ) {
        // La clave declarada determina todos los atributos; esa regla no impide extraerlos.
        if (
          [...declared, ...empirical].some((rule) =>
            [...rule.left, ...rule.right].some((name) => group.includes(name)),
          )
        )
          throw Error(
            'Un grupo repetido participa en reglas adicionales. Se necesita aclarar su significado antes de extraerlo.',
          );
      }
      const [next, child] = firstNormalForm(parent, group);
      child.name =
        table.name.replace(/\./g, '_') + '_' + group[0].replace(/[_]?\d+$/, '') + '_Valores';
      children.push(child);
      parent = next;
      assumptions.push(
        `Grupo supuesto por numeración y tipo: ${group.join(', ')}. Se extrae a ${child.name}; revisa que represente el mismo atributo multivalor.`,
      );
    }
    const rules = projection(
      parent.columns.map((c) => c.name),
      result.rules,
    );
    result.diagnosis = analyze(parent, rules, true);
    result.form = children.length
      ? 'No normalizada (grupo repetido supuesto)'
      : result.diagnosis.form + ' bajo las reglas disponibles';
    result.stages.push({
      label: '1FN',
      explanation: children.length
        ? 'Se extraen grupos repetidos; la clave hija se amplía con Posicion. No se dividen listas ni se migran filas.'
        : 'Se conserva la estructura; la atomicidad es un supuesto explícito.',
      tables: [parent, ...children],
    });
    for (const target of ['2FN', '3FN'] as const) {
      const tables = normalize(parent, rules, target);
      // Conservar las FK externas; assembleProject las resolverá sobre el conjunto completo.
      for (const relation of tables) {
        for (const foreign of parent.foreignKeys)
          if (foreign.columns.every((name) => relation.columns.some((c) => c.name === name)))
            relation.foreignKeys.push(foreign);
      }
      const remaining = children.map((child) => {
        const copy = structuredClone(child);
        const owner = tables.find(
          (t) =>
            parent.primaryKey.every((name) => t.primaryKey.includes(name)) &&
            t.primaryKey.length === parent.primaryKey.length,
        );
        if (!owner) throw Error('No se puede reubicar la clave del grupo repetido sin ambigüedad.');
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
    }
  } catch (error) {
    result.error = (error as Error).message;
    result.stages = [];
  }
  return result;
}
