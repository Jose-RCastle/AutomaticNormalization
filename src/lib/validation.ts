import { Column, SampleRow, Table } from './models';

export function compatibleReferenceColumns(left: Column, right: Column) {
  const signature = (column: Column) => {
    let type = column.type
      .toUpperCase()
      .replace(/\s+/g, '')
      .replace(/^INTEGER\b/, 'INT')
      .replace(/^NUMERIC\b/, 'DECIMAL');
    if (type === 'DECIMAL') type = 'DECIMAL(18,0)';
    type = type.replace(/^DECIMAL\((\d+)\)$/, 'DECIMAL($1,0)');
    return type.replace(/^(N?VARCHAR|N?CHAR|VARBINARY|BINARY)\(\d+\)$/, '$1');
  };
  if (signature(left) !== signature(right)) return false;
  return (
    !/^(N?VARCHAR|N?CHAR|TEXT|NTEXT)\b/i.test(left.type) ||
    (left.collation || '').toUpperCase() === (right.collation || '').toUpperCase()
  );
}

export function relationshipProblems(tables: Table[]) {
  const errors: string[] = [];
  for (const t of tables) {
    const seen = new Set<string>();
    for (const f of t.foreignKeys) {
      const id = JSON.stringify([f.columns, f.table, f.references]);
      if (seen.has(id)) errors.push(`${t.name}: FK duplicada a ${f.table}.`);
      seen.add(id);
      const target = tables.find((other) => other.name === f.table);
      if (!target || !f.columns.length || f.columns.length !== f.references.length) {
        errors.push(`${t.name}: FK incompleta o destino inexistente: ${f.table}.`);
        continue;
      }
      const key = [target.primaryKey, ...(target.uniqueKeys || [])].some(
        (k) => k.length === f.references.length && k.every((n) => f.references.includes(n)),
      );
      if (!key) errors.push(`${t.name}: la FK a ${f.table} no referencia una clave.`);
      f.columns.forEach((name, i) => {
        const local = t.columns.find((c) => c.name === name);
        const remote = target.columns.find((c) => c.name === f.references[i]);
        if (!local || !remote || !compatibleReferenceColumns(local, remote))
          errors.push(
            `${t.name}: FK a ${f.table} con columnas, tipos o intercalaciones incompatibles.`,
          );
        if (local && (f.onDelete === 'SET NULL' || f.onUpdate === 'SET NULL') && !local.nullable)
          errors.push(`${t.name}: SET NULL requiere columnas nullable en la FK.`);
      });
    }
  }
  return [...new Set(errors)];
}

/** A cycle is legal SQL and says nothing about normal form; report it as advice. */
export function relationshipWarnings(tables: Table[]) {
  const errors: string[] = [];
  const graph = new Map(tables.map((t) => [t.name, t.foreignKeys.map((f) => f.table)]));
  const active = new Set<string>(),
    done = new Set<string>();
  function visit(name: string, path: string[]) {
    if (active.has(name)) {
      errors.push(
        'Ciclo de FK: ' +
          [...path.slice(path.indexOf(name)), name].join(' → ') +
          '. Planifica el orden de carga y revisa las acciones en cascada en SQL Server.',
      );
      return;
    }
    if (done.has(name)) return;
    active.add(name);
    for (const next of graph.get(name) || []) if (graph.has(next)) visit(next, [...path, name]);
    active.delete(name);
    done.add(name);
  }
  for (const t of tables) visit(t.name, []);
  return [...new Set(errors)];
}
export interface Verification {
  status: 'passed' | 'failed' | 'limited' | 'unavailable';
  rows: number;
  message: string;
}
export function verifyJoin(rows: SampleRow[], tables: Table[], attributes: string[]): Verification {
  if (!rows.length)
    return { status: 'unavailable', rows: 0, message: 'Sin registros para comprobar la reunión.' };
  const signature = (r: SampleRow, names: string[]) =>
    JSON.stringify(names.map((n) => r[n] ?? null));
  const distinct = (data: SampleRow[], names: string[]) => [
    ...new Map(data.map((r) => [signature(r, names), r])).values(),
  ];
  const projections = tables
    .map((t) => {
      const names = t.columns.map((c) => c.name).filter((n) => attributes.includes(n));
      return {
        names,
        rows: distinct(
          rows.map((r) => Object.fromEntries(names.map((n) => [n, r[n] ?? null]))),
          names,
        ),
      };
    })
    .filter((p) => p.names.length);
  projections.sort((a, b) => b.names.length - a.names.length);
  let joined: SampleRow[] = [{}],
    known: string[] = [];
  let work = 0;
  const started = Date.now();
  for (const p of projections) {
    const shared = p.names.filter((n) => known.includes(n));
    const buckets = new Map<string, SampleRow[]>();
    for (const r of p.rows) {
      const key = signature(r, shared);
      buckets.set(key, [...(buckets.get(key) || []), r]);
    }
    const out: SampleRow[] = [];
    for (const a of joined) {
      if (shared.some((n) => a[n] === null))
        return {
          status: 'limited',
          rows: rows.length,
          message: 'Hay NULL en columnas de reunión: no se certifica equivalencia SQL.',
        };
      for (const b of buckets.get(signature(a, shared)) || []) {
        if (++work > 100000 || Date.now() - started > 1500)
          return {
            status: 'limited',
            rows: rows.length,
            message: 'La reunión alcanzó su presupuesto; no se emitió una verificación parcial.',
          };
        out.push({ ...a, ...b });
      }
    }
    known = [...new Set([...known, ...p.names])];
    joined = distinct(out, known);
  }
  const expected = new Set(rows.map((r) => signature(r, attributes))),
    actual = new Set(joined.map((r) => signature(r, attributes)));
  const passed =
    attributes.every((n) => known.includes(n)) &&
    expected.size === actual.size &&
    [...expected].every((r) => actual.has(r));
  return {
    status: passed ? 'passed' : 'failed',
    rows: rows.length,
    message: passed
      ? 'Reunión natural de las proyecciones = filas originales de la muestra (semántica de conjuntos).'
      : 'La reunión produce filas distintas o pierde registros.',
  };
}
