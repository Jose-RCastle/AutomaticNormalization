import dagre from '@dagrejs/dagre';
import { ForeignKey, Table } from './models';
import { relationshipProblems } from './validation';

const quote = (name: string) => '[' + name.replace(/]/g, ']]') + ']';
const literal = (value: string) => "N'" + value.replace(/'/g, "''") + "'";
const parts = (table: Table) => table.sqlName || table.name.split('.');
const qualified = (table: Table) => parts(table).map(quote).join('.');
export function exportSQL(input: Table[], options: { schema?: string } = {}): string {
  const problems = relationshipProblems(input);
  if (problems.length) throw Error(problems.join(' '));
  const tables = structuredClone(input);
  if (options.schema) {
    const used = new Set<string>(),
      names = new Map<string, string>();
    for (const t of tables) {
      let name = parts(t).at(-1)!;
      if (used.has(name.toLowerCase())) name = parts(t).join('_');
      let candidate = name,
        i = 2;
      while (used.has(candidate.toLowerCase())) candidate = name + '_' + i++;
      used.add(candidate.toLowerCase());
      names.set(t.name, options.schema + '.' + candidate);
      t.sqlName = [options.schema, candidate];
    }
    for (const t of tables) {
      t.name = names.get(t.name)!;
      t.foreignKeys.forEach((f) => (f.table = names.get(f.table) || f.table));
    }
  }
  const constraint = (prefix: string, table: Table, suffix: string) => {
    const name = [prefix, parts(table).at(-1), suffix].filter(Boolean).join('_');
    let hash = 2166136261;
    for (const c of name) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619);
    return name.length <= 128 ? name : name.slice(0, 115) + '_' + (hash >>> 0).toString(16);
  };
  const schemas = [
    ...new Set(tables.flatMap((t) => (parts(t).length === 2 ? [parts(t)[0]] : []))),
  ].filter((n) => n.toLowerCase() !== 'dbo');
  const definitions = tables.map((table) => {
    const columns = table.columns.map((c) =>
      c.computed && c.expression
        ? `  ${quote(c.name)} AS ${c.expression}${c.persisted ? ' PERSISTED' : ''}`
        : `  ${quote(c.name)} ${c.type}${c.collation ? ' COLLATE ' + c.collation : ''}${c.identity ? ' ' + c.identity : ''} ${c.nullable ? 'NULL' : 'NOT NULL'}${c.default ? ' DEFAULT ' + c.default : ''}`,
    );
    if (table.primaryKey.length)
      columns.push(
        `  CONSTRAINT ${quote(constraint('PK', table, ''))} PRIMARY KEY (${table.primaryKey.map(quote).join(', ')})`,
      );
    for (const [i, key] of (table.uniqueKeys || []).entries())
      columns.push(
        `  CONSTRAINT ${quote(constraint('UQ', table, String(i + 1)))} UNIQUE (${key.map(quote).join(', ')})`,
      );
    for (const [i, check] of (table.checks || []).entries())
      columns.push(
        `  CONSTRAINT ${quote(constraint('CK', table, String(i + 1)))} CHECK (${check.expression})`,
      );
    return `CREATE TABLE ${qualified(table)} (\n${columns.join(',\n')}\n);`;
  });
  const references = tables.flatMap((table) =>
    table.foreignKeys.map((f, index) => {
      const target = tables.find((t) => t.name === f.table);
      const actions = `${f.onDelete ? ' ON DELETE ' + f.onDelete : ''}${f.onUpdate ? ' ON UPDATE ' + f.onUpdate : ''}`;
      return `ALTER TABLE ${qualified(table)} ADD CONSTRAINT ${quote(constraint('FK', table, (target ? parts(target).at(-1) : 'ref') + '_' + (index + 1)))} FOREIGN KEY (${f.columns.map(quote).join(', ')}) REFERENCES ${target ? qualified(target) : f.table.split('.').map(quote).join('.')} (${f.references.map(quote).join(', ')})${actions};`;
    }),
  );
  return (
    [
      `-- SQL Server: estructuras propuestas para un destino vacío${options.schema ? ' en el esquema ' + options.schema : ''}. No migra registros.`,
      '-- Revisar las reglas observadas y los cambios de nulabilidad antes de migrar datos.',
      ...tables.flatMap((t) => (t.warnings || []).map((w) => '-- ' + w.replace(/[\r\n]/g, ' '))),
      ...tables.flatMap((t) =>
        (t.observedUniqueKeys || []).map(
          (k) =>
            '-- ' +
            t.name +
            ': observado, único en la muestra (' +
            k.join(', ') +
            '); no se activa UNIQUE sin confirmación.',
        ),
      ),
      'SET XACT_ABORT ON;\nBEGIN TRANSACTION;',
      ...tables.map(
        (t) =>
          `IF OBJECT_ID(${literal(qualified(t))}) IS NOT NULL THROW 50001, N'El destino debe estar vacío; ya existe una tabla de salida.', 1;`,
      ),
      ...schemas.map(
        (n) => `IF SCHEMA_ID(${literal(n)}) IS NULL EXEC(${literal('CREATE SCHEMA ' + quote(n))});`,
      ),
      ...definitions,
      ...references,
      'COMMIT TRANSACTION;',
    ].join('\n\n') + '\n'
  );
}

export function cardinality(table: Table, fk: ForeignKey) {
  const optional = fk.columns.some((n) => table.columns.find((c) => c.name === n)?.nullable);
  const unique = [table.primaryKey, ...(table.uniqueKeys || [])].some(
    (k) => k.length && k.every((n) => fk.columns.includes(n)),
  );
  return { parent: optional ? '0..1' : '1', child: unique ? '0..1' : '0..N', optional, unique };
}
export function exportMermaid(tables: Table[]): string {
  const safe = (name: string) => name.replace(/[^a-zA-Z0-9_]/g, '_');
  const ids = new Map(tables.map((t, i) => [t.name, `T${i}_${safe(t.name)}`]));
  const entities = tables.map(
    (t) =>
      `  ${ids.get(t.name)} {\n${t.columns
        .map((c, i) => {
          const tags = [
            t.primaryKey.includes(c.name) ? 'PK' : '',
            t.foreignKeys.some((f) => f.columns.includes(c.name)) ? 'FK' : '',
            (t.uniqueKeys || []).some((k) => k.includes(c.name)) ? 'UK' : '',
          ].filter(Boolean);
          return `    ${safe(c.type)} c${i}_${safe(c.name)}${tags.length ? ' ' + tags.join(', ') : ''}`;
        })
        .join('\n')}\n  }`,
  );
  const edges = tables.flatMap((t) =>
    t.foreignKeys
      .filter((f) => ids.has(f.table))
      .map((f) => {
        const c = cardinality(t, f);
        return `  ${ids.get(f.table)} ${c.optional ? '|o' : '||'}--${c.unique ? 'o|' : 'o{'} ${ids.get(t.name)} : "${safe(f.columns.join('_'))}"`;
      }),
  );
  return ['erDiagram', ...entities, ...edges].join('\n') + '\n';
}
export function exportSVG(tables: Table[]): string {
  const escape = (s: string) =>
    s.replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!,
    );
  const graph = new dagre.graphlib.Graph({ multigraph: true });
  graph.setGraph({ rankdir: 'LR', nodesep: 65, ranksep: 150, marginx: 35, marginy: 40 });
  graph.setDefaultEdgeLabel(() => ({}));
  tables.forEach((t) => graph.setNode(t.name, { width: 360, height: 64 + t.columns.length * 25 }));
  const edges: { source: Table; fk: ForeignKey; id: string }[] = [];
  tables.forEach((t) =>
    t.foreignKeys.forEach((f) => {
      if (!graph.hasNode(f.table)) return;
      const id = String(edges.length);
      edges.push({ source: t, fk: f, id });
      graph.setEdge(t.name, f.table, { width: 95, height: 30 }, id);
    }),
  );
  dagre.layout(graph);
  const width = Math.max(440, graph.graph().width || 0),
    height = Math.max(200, graph.graph().height || 0);
  const paths = edges
    .map(({ source, fk, id }) => {
      const edge = graph.edge({ v: source.name, w: fk.table, name: id });
      const points = edge.points;
      const d = points.map((p, i) => `${i ? 'L' : 'M'} ${p.x} ${p.y}`).join(' ');
      const c = cardinality(source, fk);
      const middle = points[Math.floor(points.length / 2)];
      return `<g><title>${escape(source.name + ' (' + fk.columns.join(', ') + ') → ' + fk.table + ' (' + fk.references.join(', ') + ')')}</title><path d="${d}" fill="none" stroke="#888" stroke-width="1.5" marker-end="url(#arrow)"/><rect x="${middle.x - 46}" y="${middle.y - 19}" width="92" height="18" fill="#fafafa"/><text x="${middle.x}" y="${middle.y - 6}" text-anchor="middle" font-size="11">${c.child} → ${c.parent}</text></g>`;
    })
    .join('');
  const short = (s: string, n: number) => escape(s.length > n ? s.slice(0, n - 1) + '…' : s);
  const nodes = tables
    .map((t) => {
      const node = graph.node(t.name),
        x = node.x - 180,
        y = node.y - node.height / 2;
      const rows = t.columns
        .map((c, i) => {
          const flags = [
            t.primaryKey.includes(c.name) ? 'PK' : '',
            t.foreignKeys.some((f) => f.columns.includes(c.name)) ? 'FK' : '',
            (t.uniqueKeys || []).some((k) => k.includes(c.name)) ? 'UQ' : '',
          ]
            .filter(Boolean)
            .join(' ');
          return `<g><title>${escape(c.name + ': ' + c.type + (c.nullable ? ' NULL' : ' NOT NULL') + (c.identity ? ' ' + c.identity : ''))}</title><text x="${x + 12}" y="${y + 58 + i * 25}" font-size="10" fill="#777">${flags}</text><text x="${x + 65}" y="${y + 58 + i * 25}" font-size="12">${short(c.name, 23)}</text><text x="${x + 245}" y="${y + 58 + i * 25}" font-size="10" fill="#666">${short(c.type, 15)}</text></g>`;
        })
        .join('');
      return `<g><title>${escape(t.name)}</title><rect x="${x}" y="${y}" width="360" height="${node.height}" rx="6" fill="#fff" stroke="#aaa"/><path d="M ${x} ${y + 38} H ${x + 360}" stroke="#ddd"/><text x="${x + 12}" y="${y + 25}" font-weight="bold" font-size="13">${short(t.name, 43)}</text>${rows}</g>`;
    })
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Tablas y relaciones"><defs><marker id="arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" fill="#777"/></marker></defs><rect width="100%" height="100%" fill="#fafafa"/><g font-family="ui-monospace,monospace" fill="#262626">${paths}${nodes}</g></svg>`;
}
