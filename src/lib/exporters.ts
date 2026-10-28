import { Table } from './models';

const quote = (name: string) => '[' + name.replace(/]/g, ']]') + ']';
const literal = (value: string) => "N'" + value.replace(/'/g, "''") + "'";
const qualified = (table: Table) => (table.sqlName || table.name.split('.')).map(quote).join('.');

export function exportSQL(tables: Table[]): string {
  const schemas = [
    ...new Set(tables.flatMap((table) => (table.sqlName?.length === 2 ? [table.sqlName[0]] : []))),
  ].filter((name) => name.toLowerCase() !== 'dbo');
  const createSchemas = schemas.map(
    (name) =>
      `IF SCHEMA_ID(${literal(name)}) IS NULL EXEC(${literal('CREATE SCHEMA ' + quote(name))});`,
  );
  const definitions = tables.map((table) => {
    const columns = table.columns.map(
      (column) =>
        `  ${quote(column.name)} ${column.type}${column.identity ? ' ' + column.identity : ''} ${column.nullable ? 'NULL' : 'NOT NULL'}`,
    );
    if (table.primaryKey.length)
      columns.push(`  PRIMARY KEY (${table.primaryKey.map(quote).join(', ')})`);
    for (const key of table.uniqueKeys || [])
      columns.push(`  UNIQUE (${key.map(quote).join(', ')})`);
    return `CREATE TABLE ${qualified(table)} (\n${columns.join(',\n')}\n);`;
  });
  // Crear todas las tablas antes de agregar referencias también admite ciclos.
  const references = tables.flatMap((table) =>
    table.foreignKeys.map((reference) => {
      const target = tables.find((other) => other.name === reference.table);
      const targetName = target
        ? qualified(target)
        : reference.table.split('.').map(quote).join('.');
      return `ALTER TABLE ${qualified(table)} ADD FOREIGN KEY (${reference.columns.map(quote).join(', ')}) REFERENCES ${targetName} (${reference.references.map(quote).join(', ')});`;
    }),
  );
  return (
    [
      '-- SQL Server: esquema vacío. Revisar antes de ejecutar; no migra datos.',
      ...createSchemas,
      ...definitions,
      ...references,
    ].join('\n\n') + '\n'
  );
}

export function exportMermaid(tables: Table[]): string {
  const safe = (name: string) => name.replace(/[^a-zA-Z0-9_]/g, '_');
  const ids = new Map(tables.map((table, index) => [table.name, `T${index}_${safe(table.name)}`]));
  const entities = tables.map(
    (table) =>
      `  ${ids.get(table.name)} {\n${table.columns.map((column, index) => `    ${safe(column.type)} c${index}_${safe(column.name)}${table.primaryKey.includes(column.name) ? ' PK' : ''}`).join('\n')}\n  }`,
  );
  const references = tables.flatMap((table) =>
    table.foreignKeys
      .filter((reference) => ids.has(reference.table))
      .map(
        (reference) => `  ${ids.get(reference.table)} ||--o{ ${ids.get(table.name)} : referencia`,
      ),
  );
  return ['erDiagram', ...entities, ...references].join('\n') + '\n';
}
export function exportSVG(tables: Table[]): string {
  const escape = (value: string) =>
    value.replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!,
    );
  const rowHeight = Math.max(200, ...tables.map((table) => 105 + table.columns.length * 25));
  const width = 1060,
    height = Math.max(240, Math.ceil(tables.length / 2) * rowHeight + 40);
  const positions = tables.map((_, index) => ({
    x: 30 + (index % 2) * 530,
    y: 30 + Math.floor(index / 2) * rowHeight,
  }));
  const boxHeight = (index: number) => 55 + tables[index].columns.length * 25;
  const edges = tables
    .flatMap((table, index) =>
      table.foreignKeys.map((reference) => {
        const target = tables.findIndex((other) => other.name === reference.table);
        if (target < 0) return '';
        const from = positions[index],
          to = positions[target];
        let path: string, labelX: number, labelY: number;
        if (from.y === to.y) {
          const right = from.x < to.x;
          const x1 = from.x + (right ? 470 : 0),
            x2 = to.x + (right ? 0 : 470);
          const y1 = from.y + 53,
            y2 = to.y + 53;
          path = `M ${x1} ${y1} L ${(x1 + x2) / 2} ${y1} L ${(x1 + x2) / 2} ${y2} L ${x2} ${y2}`;
          labelX = (x1 + x2) / 2;
          labelY = y1 - 8;
        } else {
          const y1 = from.y + boxHeight(index),
            y2 = to.y;
          const x1 = from.x + 235,
            x2 = to.x + 235;
          const lane = Math.max(from.x, to.x) + 490;
          path = `M ${x1} ${y1} L ${x1} ${y1 + 18} L ${lane} ${y1 + 18} L ${lane} ${y2 - 12} L ${x2} ${y2 - 12} L ${x2} ${y2}`;
          labelX = x1 + 8;
          labelY = y1 + 15;
        }
        return `<g><title>${escape(table.name)} → ${escape(reference.table)}</title><path d="${path}" fill="none" stroke="#659478" stroke-width="1.6" marker-end="url(#arrow)"/><text x="${labelX}" y="${labelY}" font-size="9" fill="#416c50">FK</text></g>`;
      }),
    )
    .join('');
  const nodes = tables
    .map((table, index) => {
      const { x, y } = positions[index];
      const short = (value: string, length: number) =>
        escape(value.length > length ? value.slice(0, length - 1) + '…' : value);
      return `<g><title>${escape(table.name)}</title><rect x="${x}" y="${y}" width="470" height="${boxHeight(index)}" rx="8" fill="white" stroke="#8ab39b"/><rect x="${x + 1}" y="${y + 1}" width="468" height="36" rx="7" fill="#e3f1e8"/><text x="${x + 12}" y="${y + 23}" font-size="12" font-weight="bold">${short(table.name, 57)}</text>${table.columns.map((column, row) => `<text x="${x + 12}" y="${y + 57 + row * 25}" font-size="12"><title>${escape(column.name)}</title>${table.primaryKey.includes(column.name) ? '◆ ' : ''}${short(column.name, 34)}</text><text x="${x + 310}" y="${y + 57 + row * 25}" font-size="10" fill="#64776b">${short(column.type, 22)}</text>`).join('')}</g>`;
    })
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Diagrama entidad relación"><defs><marker id="arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" fill="#528a70"/></marker></defs><rect width="100%" height="100%" fill="#f8fbf9"/><g font-family="monospace" fill="#234d37">${edges}${nodes}</g></svg>`;
}
