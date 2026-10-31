import { Table } from './models';

export interface ProjectModel {
  tables: Table[];
  warnings: string[];
  errors: string[];
  completed: number;
}

/** Reúne resultados independientes sin inventar uniones ni destinos de claves. */
export function assembleProject(
  sources: Table[],
  results: ReadonlyMap<string, Table[]>,
): ProjectModel {
  const warnings: string[] = [],
    errors: string[] = [];
  const replacements = new Map(
    sources.map((source) => [
      source.name,
      results.get(source.name)?.length ? results.get(source.name)! : [source],
    ]),
  );
  const tables = structuredClone([...replacements.values()].flat());
  const names = new Set<string>();
  for (const table of tables) {
    const name = table.name.toLowerCase();
    if (names.has(name))
      errors.push(
        `Nombre de tabla duplicado: ${table.name}. Revisa las descomposiciones antes de exportar.`,
      );
    names.add(name);
  }
  const contains = (table: Table, columns: string[]) =>
    columns.every((name) => table.columns.some((column) => column.name === name));
  const isKey = (table: Table, columns: string[]) =>
    [table.primaryKey, ...(table.uniqueKeys || [])].some(
      (key) =>
        key.length > 0 &&
        key.length === columns.length &&
        key.every((name) => columns.includes(name)),
    );
  const add = (table: Table, reference: Table['foreignKeys'][number]) => {
    if (
      !table.foreignKeys.some((existing) => JSON.stringify(existing) === JSON.stringify(reference))
    )
      table.foreignKeys.push(reference);
  };
  // Las FK de las tablas originales se reubican únicamente si existe un destino inequívoco.
  for (const source of sources) {
    if (!results.get(source.name)?.length)
      warnings.push(`${source.name}: conserva la estructura original; normalización pendiente.`);
    for (const reference of source.foreignKeys) {
      const owners = (replacements.get(source.name) || []).filter((table) =>
        contains(table, reference.columns),
      );
      const targets = (replacements.get(reference.table) || []).filter(
        (table) => contains(table, reference.references) && isKey(table, reference.references),
      );
      for (const table of tables.filter((table) =>
        owners.some((owner) => owner.name === table.name),
      )) {
        // Quitar la referencia original antes de resolverla; nunca exportar un destino inexistente.
        table.foreignKeys = table.foreignKeys.filter(
          (existing) => JSON.stringify(existing) !== JSON.stringify(reference),
        );
        if (targets.length === 1) add(table, { ...reference, table: targets[0].name });
      }
      if (!owners.length || targets.length !== 1)
        errors.push(
          `${source.name} (${reference.columns.join(', ')}) → ${reference.table}: no se puede reubicar la referencia de forma inequívoca. Revisa las columnas y claves del modelo.`,
        );
    }
  }
  for (const table of tables) {
    if (table.issues?.length) errors.push(`${table.name}: ${table.issues.join(' ')}`);
    for (const reference of table.foreignKeys) {
      const target = tables.find((other) => other.name === reference.table);
      if (
        !contains(table, reference.columns) ||
        !target ||
        !contains(target, reference.references) ||
        !isKey(target, reference.references)
      )
        errors.push(`${table.name}: referencia inválida a ${reference.table}.`);
    }
  }
  return {
    tables,
    warnings: [...new Set(warnings)],
    errors: [...new Set(errors)],
    completed: sources.filter((source) => results.get(source.name)?.length).length,
  };
}
