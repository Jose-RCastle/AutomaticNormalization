import { FD, SampleRow, Table } from './models';
import {
  analyze,
  closure,
  dependencies,
  parseDependencies,
  projection,
  candidateKeys,
  subset,
} from './relational';
import { normalize } from './decomposition';
import { numberedNormalForm, listNormalForm } from './first-normal-form';
import { recommendedRules, ReviewDecisions, ruleId } from './review';
import { Verification, verifyJoin } from './validation';

export interface ParsedTable extends Table {
  review?: ReviewDecisions;
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
    keyCandidates?: string[][];
    sampleRows?: SampleRow[];
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
  pending: string[];
  suggestedRules: FD[];
  prerequisites: { label: string; status: 'passed' | 'failed' | 'unknown'; detail: string }[];
  verification?: Verification;
  idempotent?: boolean;
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
    pending: [],
    suggestedRules: [],
    prerequisites: [],
  };
  try {
    if (source.issues?.length) throw Error(source.issues.join(' '));
    const table = structuredClone(source);
    const review = table.review || {};
    const rows = table.profile?.sampleRows || [];
    if (review.primaryKey?.length) {
      if (review.primaryKey.some((n) => !table.columns.some((c) => c.name === n)))
        throw Error('La clave confirmada contiene una columna inexistente.');
      const seen = new Set<string>();
      for (const row of rows) {
        const values = review.primaryKey.map((n) => row[n]);
        const id = JSON.stringify(values);
        if (values.some((v) => v == null) || seen.has(id))
          throw Error('La muestra contradice la clave confirmada.');
        seen.add(id);
      }
      table.primaryKey = [...review.primaryKey];
      table.primaryKey.forEach((n) => (table.columns.find((c) => c.name === n)!.nullable = false));
    }
    let hasUsableKey =
      table.primaryKey.length > 0 ||
      (source.uniqueKeys || []).some(
        (k) => k.length && k.every((n) => source.columns.some((c) => c.name === n && !c.nullable)),
      );
    table.origin = source.name;
    if (!hasUsableKey && !review.syntheticKey)
      result.pending.push(
        'Confirma una clave candidata o la creación de una clave técnica antes de exportar.',
      );
    const unresolvedLists = (table.profile?.listCandidates || []).filter(
      (c) =>
        !review.lists?.some((l) => l.column === c.column) &&
        !review.scalarColumns?.includes(c.column),
    );
    if (unresolvedLists.length)
      result.pending.push('Confirma si los posibles multivalores son listas o texto escalar.');
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
        if (review.syntheticKey) hasUsableKey = true;
        assumptions.push(
          `Sin clave declarada: se propone ${name}, una clave técnica IDENTITY. No se ha supuesto que las filas de la muestra constituyan una clave de negocio.`,
        );
      }
    }
    const declared = parseDependencies((table.rules || []).join('\n'), table);
    const empirical = table.profile?.observedRules || [];
    const accepted = review.acceptedRules || [];
    for (const rule of [...declared, ...accepted]) {
      if ([...rule.left, ...rule.right].some((n) => !table.columns.some((c) => c.name === n)))
        throw Error('Regla con columnas inexistentes.');
      const seen = new Map<string, string>();
      for (const row of rows) {
        if ([...rule.left, ...rule.right].some((n) => row[n] == null)) continue;
        const left = JSON.stringify(rule.left.map((n) => row[n])),
          right = JSON.stringify(rule.right.map((n) => row[n]));
        if (seen.has(left) && seen.get(left) !== right)
          throw Error(
            'La muestra contradice ' + rule.left.join(', ') + ' → ' + rule.right.join(', '),
          );
        seen.set(left, right);
      }
    }
    const recommendations = recommendedRules(table, empirical).filter(
      (f) => !review.rejectedRules?.includes(ruleId(f)),
    );
    result.suggestedRules = empirical;
    if (empirical.length && !declared.length)
      assumptions.push(
        'Dependencias descubiertas en los INSERT: hipótesis de la muestra, no reglas universales. Revisa la propuesta antes de aplicarla.',
      );
    if (!declared.length && !empirical.length)
      assumptions.push(
        'Solo hay dependencias de claves declaradas. Pueden faltar dependencias parciales o transitivas del negocio.',
      );
    // Keep declared semantics authoritative when present; observed rules remain visible in the profile.
    const effective = [...declared, ...accepted, ...(declared.length ? [] : recommendations)];
    const trusted = dependencies(table, [...declared, ...accepted]);
    const unconfirmed = effective.filter((f) => !subset(f.right, closure(f.left, trusted)));
    if (unconfirmed.length)
      result.pending.push(
        `Hay ${unconfirmed.length} dependencias simples observadas usadas en la propuesta sin confirmar. Las compuestas solo se usan si las confirmas.`,
      );
    if (!declared.length && !accepted.length && !table.profile?.rowCount && !review.rulesComplete)
      result.pending.push(
        'No se puede determinar la forma normal semántica sin datos ni reglas del negocio.',
      );
    if (!review.atomicConfirmed)
      result.pending.push('Confirma la atomicidad de los valores en los prerrequisitos.');
    if (!review.rulesComplete)
      result.pending.push(
        'Confirma que las reglas de negocio están completas; las sugerencias no aceptadas no se usan como restricciones.',
      );
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
    for (const list of review.lists || []) {
      const [next, child] = listNormalForm(parent, list.column, list.separator);
      if (list.unique) child.uniqueKeys = [[...parent.primaryKey, child.columns.at(-1)!.name]];
      children.push(child);
      parent = next;
      assumptions.push(
        `${list.column}: lista confirmada; se omiten valores vacíos y se conserva su posición. No se ejecutó una migración.`,
      );
    }
    for (const child of children) {
      if (review.uniqueGroups?.includes(child.name))
        child.uniqueKeys = [
          [
            ...parent.primaryKey,
            ...child.columns
              .filter((c) => !parent.primaryKey.includes(c.name) && !c.name.startsWith('Posicion'))
              .map((c) => c.name),
          ],
        ];
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
        : unresolvedLists.length
          ? 'Sin confirmar 1FN (posible multivalor)'
          : !declared.length &&
              !accepted.length &&
              !table.profile?.rowCount &&
              !review.rulesComplete
            ? 'No se puede determinar sin datos ni reglas'
            : result.diagnosis.form + ' bajo las reglas disponibles';
    result.prerequisites = [
      {
        label: 'Clave definida',
        status: hasUsableKey ? 'passed' : 'failed',
        detail: hasUsableKey
          ? table.primaryKey.join(', ')
          : 'Confirma una clave; la identidad técnica es solo una propuesta.',
      },
      {
        label: 'Valores atómicos',
        status: unresolvedLists.length ? 'unknown' : review.atomicConfirmed ? 'passed' : 'unknown',
        detail: unresolvedLists.length
          ? 'Posibles listas pendientes.'
          : 'La atomicidad necesita conocimiento del dominio.',
      },
      {
        label: 'Grupos repetidos',
        status: children.length ? 'failed' : 'passed',
        detail: children.length
          ? 'Detectados y separados en la propuesta.'
          : 'Sin grupos numerados detectados.',
      },
      {
        label: 'Filas duplicadas',
        status: table.profile?.rowCount
          ? table.profile.duplicateRows
            ? 'failed'
            : 'passed'
          : 'unknown',
        detail: table.profile?.rowCount
          ? `${table.profile.duplicateRows} duplicadas en ${table.profile.rowCount} filas.`
          : 'Sin registros.',
      },
    ];
    if (table.profile?.duplicateRows)
      result.pending.push(
        'Resuelve o confirma el significado de las filas duplicadas antes de exportar.',
      );
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
              : 'Síntesis 3FN por cubierta mínima, clausuras e inclusión de clave: preservación de dependencias y reunión sin pérdida bajo las reglas confirmadas.',
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
    const observedKeysCache = new Map<string, string[][]>();
    const observedDependencies = dependencies(table, empirical);
    for (const step of result.stages) {
      for (const relation of step.tables) {
        const localTrusted = projection(
          relation.columns.map((c) => c.name),
          trusted,
        );
        const speculative = (relation.uniqueKeys || []).filter(
          (k) =>
            !table.uniqueKeys?.some(
              (original) => original.length === k.length && subset(original, k),
            ) &&
            !subset(
              relation.columns.map((c) => c.name),
              closure(k, localTrusted),
            ),
        );
        const names = relation.columns.map((c) => c.name),
          signature = JSON.stringify(names);
        try {
          if (!observedKeysCache.has(signature))
            observedKeysCache.set(
              signature,
              candidateKeys(names, projection(names, observedDependencies)),
            );
          relation.observedUniqueKeys = (observedKeysCache.get(signature) || []).filter(
            (k) =>
              !subset(names, closure(k, localTrusted)) &&
              !(k.length === relation.primaryKey.length && subset(k, relation.primaryKey)),
          );
        } catch {
          relation.observedUniqueKeys = speculative;
          relation.warnings = [
            ...(relation.warnings || []),
            'La búsqueda de claves observadas alcanzó su presupuesto.',
          ];
        }
        relation.uniqueKeys = (relation.uniqueKeys || []).filter((k) => !speculative.includes(k));
        // Physical uniqueness is emitted only for declared/confirmed knowledge.
      }
    }
    const last = result.stages[2];
    if (last?.tables.length) {
      const parentRows = rows.map((row, i) =>
        Object.fromEntries(
          parent.columns.map((c) => [
            c.name,
            c.identity && !source.columns.some((old) => old.name === c.name)
              ? String(i + 1)
              : (row[c.name] ?? null),
          ]),
        ),
      );
      result.verification = verifyJoin(
        parentRows,
        last.tables.filter((t) => !children.some((c) => c.name === t.name)),
        parent.columns.map((c) => c.name),
      );
      for (const child of children) {
        const seen = (child.uniqueKeys || []).map(() => new Set<string>());
        for (let i = 0; i < rows.length; i++) {
          const sourceRow = rows[i];
          const origins = Object.entries(child.columnOrigins || {});
          const values: SampleRow[] = child.listSource
            ? String(sourceRow[child.listSource.column] ?? '')
                .split(child.listSource.separator)
                .map((v) => v.trim())
                .filter(Boolean)
                .map((v, j) => ({
                  ...parentRows[i],
                  [child.columns.find((c) => c.name.startsWith('Posicion'))!.name]: String(j + 1),
                  [child.listSource!.column]: v,
                }))
            : Array.from(
                { length: Math.max(0, ...origins.map(([, names]) => names.length)) },
                (_, j) => ({
                  ...parentRows[i],
                  [child.columns.find((c) => c.name.startsWith('Posicion'))!.name]: String(j + 1),
                  ...Object.fromEntries(
                    origins.map(([name, names]) => [name, sourceRow[names[j]] ?? null]),
                  ),
                }),
              ).filter((row) => origins.some(([name]) => row[name] != null));
          for (const row of values) {
            if (child.columns.some((c) => !c.nullable && row[c.name] == null))
              result.pending.push(
                child.name + ': hay valores parciales NULL incompatibles con la propuesta.',
              );
            (child.uniqueKeys || []).forEach((key, j) => {
              const value = JSON.stringify(key.map((n) => row[n]));
              if (seen[j].has(value))
                result.pending.push(
                  child.name + ': hay valores repetidos que contradicen el UNIQUE confirmado.',
                );
              seen[j].add(value);
            });
          }
        }
      }
      if (children.length)
        result.verification.message +=
          ' La reunión se comprueba sobre la relación padre atómica; los valores hijos se contrastan con la extracción confirmada, omitiendo posiciones vacías.';
      if (result.verification.status === 'failed' || result.verification.status === 'limited')
        result.pending.push(result.verification.message);
      result.idempotent = last.tables.every((t) => {
        const local = children.some((c) => c.name === t.name)
          ? dependencies(t, [])
          : projection(
              t.columns.map((c) => c.name),
              rules,
            );
        const again = normalize(t, local, '3FN', table.profile?.nulls);
        return again.length === 1 && JSON.stringify(again[0]) === JSON.stringify(t);
      });
      if (!result.idempotent) result.pending.push('La segunda normalización cambió el resultado.');
    }
  } catch (error) {
    result.error = (error as Error).message;
    result.stages = [];
  }
  result.pending = [...new Set(result.pending)];
  return result;
}
