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
  if (selected.some((c) => c.type !== selected[0].type))
    throw Error('Las columnas del grupo deben tener el mismo tipo de datos.');
  if (table.primaryKey.some((name) => ['posicion', 'valor'].includes(name.toLowerCase())))
    throw Error('Renombra las claves Posicion o Valor antes de extraer el grupo.');
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
    columns: [
      ...table.columns
        .filter((c) => table.primaryKey.includes(c.name))
        .map((c) => ({ name: c.name, type: c.type, nullable: false })),
      { name: 'Posicion', type: 'INT', nullable: false },
      { name: 'Valor', type: selected[0].type, nullable: false },
    ],
    primaryKey: [...table.primaryKey, 'Posicion'],
    foreignKeys: [{ columns: table.primaryKey, table: table.name, references: table.primaryKey }],
  };
  return [parent, child];
}
