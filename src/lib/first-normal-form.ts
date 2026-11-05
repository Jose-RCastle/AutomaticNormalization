import { Table } from './models';
const unique = (values: string[]) => [...new Set(values)];
export function firstNormalForm(table: Table, group: string[]): Table[] {
  if (table.issues?.length) throw Error(table.issues.join(' '));
  group = unique(group);
  if (!table.primaryKey.length) throw Error('1FN requiere una clave primaria declarada.');
  if (
    !group.length ||
    group.some((a) => !table.columns.some((c) => c.name === a) || table.primaryKey.includes(a))
  )
    throw Error('Selecciona columnas existentes fuera de la clave para el grupo repetido.');
  const selected = table.columns.filter((c) => group.includes(c.name));
  if ((table.checks || []).some((check) => check.columns.some((c) => group.includes(c))))
    throw Error(
      'El grupo repetido participa en CHECK. Define una restricción equivalente para sus valores antes de extraerlo.',
    );
  if (selected.some((c) => c.type !== selected[0].type))
    throw Error('Las columnas del grupo deben tener el mismo tipo de datos.');
  const available = (base: string) => {
    while (table.primaryKey.some((n) => n.toLowerCase() === base.toLowerCase())) base += '_';
    return base;
  };
  const position = available('Posicion'),
    value = available('Valor');
  const parent: Table = {
    ...table,
    columns: table.columns.filter((c) => !group.includes(c.name)),
    foreignKeys: table.foreignKeys.filter((f) => !f.columns.some((c) => group.includes(c))),
    uniqueKeys: (table.uniqueKeys || []).filter(
      (key) => !key.some((column) => group.includes(column)),
    ),
  };
  const child: Table = {
    name: table.name.replace(/\./g, '_').slice(0, 110) + '_Valores',
    origin: table.origin || table.name,
    columns: [
      ...table.columns
        .filter((c) => table.primaryKey.includes(c.name))
        .map((c) => ({ name: c.name, type: c.type, nullable: false, collation: c.collation })),
      { name: position, type: 'INT', nullable: false },
      {
        name: value,
        type: selected[0].type,
        nullable: selected.some((c) => c.nullable),
        collation: selected[0].collation,
      },
    ],
    primaryKey: [...table.primaryKey, position],
    foreignKeys: [{ columns: table.primaryKey, table: table.name, references: table.primaryKey }],
  };
  return [parent, child];
}

/** Columns with the same numeric positions form one tuple, preserving paired values. */
export function numberedNormalForm(
  table: Table,
  groups: { name: string; columns: string[] }[],
): Table[] {
  if (groups.length === 1) {
    const [parent, child] = firstNormalForm(table, groups[0].columns);
    const value = child.columns.at(-1)!;
    let label = groups[0].name;
    while (table.primaryKey.includes(label)) label += '_';
    value.name = label;
    value.nullable = false;
    child.columnOrigins = { [value.name]: groups[0].columns };
    child.warnings = [
      'En la representación de valores se omiten posiciones NULL. La posición conserva el orden y admite repeticiones; UNIQUE por propietario requiere confirmación.',
    ];
    child.name = table.name.replace(/\./g, '_').slice(0, 90) + '_' + groups[0].name + '_Valores';
    return [parent, child];
  }
  const removed = groups.flatMap((g) => g.columns);
  const parent: Table = {
    ...table,
    columns: table.columns.filter((c) => !removed.includes(c.name)),
    foreignKeys: table.foreignKeys.filter((f) => !f.columns.some((c) => removed.includes(c))),
  };
  let position = 'Posicion';
  while (table.primaryKey.includes(position) || groups.some((g) => g.name === position))
    position += '_';
  const child: Table = {
    name: table.name.replace(/\./g, '_').slice(0, 95) + '_Grupo_Valores',
    origin: table.origin || table.name,
    columns: [
      ...table.columns
        .filter((c) => table.primaryKey.includes(c.name))
        .map((c) => ({ name: c.name, type: c.type, nullable: false, collation: c.collation })),
      { name: position, type: 'INT', nullable: false },
      ...groups.map((g) => {
        const c = table.columns.find((c) => c.name === g.columns[0])!;
        return {
          name: g.name,
          type: c.type,
          collation: c.collation,
          nullable: g.columns.some((n) => table.columns.find((c) => c.name === n)?.nullable),
        };
      }),
    ],
    primaryKey: [...table.primaryKey, position],
    foreignKeys: [{ columns: table.primaryKey, table: table.name, references: table.primaryKey }],
    columnOrigins: Object.fromEntries(groups.map((g) => [g.name, g.columns])),
  };
  return [parent, child];
}

export function listNormalForm(table: Table, column: string, separator: string): Table[] {
  const c = table.columns.find((c) => c.name === column);
  if (!c || !separator || separator.length > 3 || table.primaryKey.includes(column))
    throw Error('Selecciona una columna no clave y un separador válido.');
  if (
    table.foreignKeys.some((f) => f.columns.includes(column)) ||
    (table.uniqueKeys || []).some((k) => k.includes(column)) ||
    (table.checks || []).some((k) => k.columns.includes(column))
  )
    throw Error('La lista participa en restricciones que requieren una traducción explícita.');
  const parent = { ...table, columns: table.columns.filter((c) => c.name !== column) };
  let position = 'Posicion';
  while (table.primaryKey.includes(position) || column === position) position += '_';
  const child: Table = {
    name: table.name.replace(/\./g, '_').slice(0, 70) + '_' + column.slice(0, 35),
    origin: table.origin || table.name,
    columns: [
      ...table.columns
        .filter((c) => table.primaryKey.includes(c.name))
        .map((c) => ({ name: c.name, type: c.type, nullable: false, collation: c.collation })),
      { name: position, type: 'INT', nullable: false },
      { name: column, type: c.type, nullable: false, collation: c.collation },
    ],
    primaryKey: [...table.primaryKey, position],
    foreignKeys: [{ columns: table.primaryKey, table: table.name, references: table.primaryKey }],
    listSource: { column, separator },
    warnings: [
      'Lista confirmada: cada elemento no vacío ocupa una fila; no se ejecutó traslado de registros.',
    ],
  };
  return [parent, child];
}
