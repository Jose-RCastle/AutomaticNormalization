export interface Column { name: string; type: string; nullable: boolean }
export interface ForeignKey { columns: string[]; table: string; references: string[] }
export interface Table { name: string; columns: Column[]; primaryKey: string[]; foreignKeys: ForeignKey[] }
export interface FD { left: string[]; right: string[] }
const unique = (a: string[]) => [...new Set(a)];
const subset = (a: string[], b: string[]) => a.every(x => b.includes(x));
const id = (s: string) => s.trim().replace(/^\[|\]$/g, '').replace(/^"|"$/g, '');
const names = (s: string) => s.split(',').map(id);
export function splitTop(s: string): string[] {
  let depth = 0, start = 0, quote = ''; const out: string[] = [];
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) { if (c === quote) { if (s[i + 1] === quote) i++; else quote = ''; } continue; }
    if (c === '[') { quote = ']'; continue; }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === '(') depth++; if (c === ')') depth--;
    if (c === ',' && depth === 0) { out.push(s.slice(start, i).trim()); start = i + 1; }
  }
  out.push(s.slice(start).trim()); return out;
}
export function parseSQL(sql: string): Table[] {
  // Deliberately limited DDL parser; never executes imported SQL.
  sql = sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '');
  const tables: Table[] = []; const re = /CREATE\s+TABLE\s+((?:\[[^\]]+\]|[\w]+)(?:\s*\.\s*(?:\[[^\]]+\]|[\w]+))?)\s*\(/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql))) {
    let end = re.lastIndex, depth = 1, quote = '';
    for (; end < sql.length && depth; end++) {
      const c = sql[end];
      if (quote) { if (c === quote) { if (sql[end + 1] === quote) end++; else quote = ''; } continue; }
      if (c === '[') quote = ']'; else if (c === "'") quote = "'"; else if (c === '(') depth++; else if (c === ')') depth--;
    }
    if (depth) throw Error('CREATE TABLE incompleto: faltan paréntesis.');
    const t: Table = { name: m[1].split('.').map(id).join('.'), columns: [], primaryKey: [], foreignKeys: [] };
    for (const raw of splitTop(sql.slice(re.lastIndex, end - 1))) {
      const line = raw.replace(/^CONSTRAINT\s+(?:\[[^\]]+\]|\w+)\s+/i, '');
      const pk = line.match(/^PRIMARY\s+KEY(?:\s+CLUSTERED|\s+NONCLUSTERED)?\s*\(([^)]+)\)/i);
      if (pk) { t.primaryKey = names(pk[1]).map(n => n.replace(/\s+(ASC|DESC)$/i, '')); continue; }
      const fk = line.match(/^FOREIGN\s+KEY\s*\(([^)]+)\)\s*REFERENCES\s+([\w.\[\]]+)\s*\(([^)]+)\)/i);
      if (fk) { t.foreignKeys.push({ columns: names(fk[1]), table: fk[2].split('.').map(id).join('.'), references: names(fk[3]) }); continue; }
      if (/^(UNIQUE|CHECK|FOREIGN|PRIMARY)\b/i.test(line)) throw Error('Restricción no soportada. Usa PRIMARY KEY y FOREIGN KEY explícitas; revisa el DDL.');
      const col = line.match(/^(\[[^\]]+\]|\w+)\s+([\w]+(?:\s*\([^)]*\))?)(.*)$/i);
      if (!col) throw Error('Definición de columna no soportada: ' + line);
      if (/\bREFERENCES\b|\bUNIQUE\b|\bAS\b/i.test(col[3])) throw Error('Usa claves foráneas de tabla; columnas calculadas y UNIQUE no están soportados.');
      t.columns.push({ name: id(col[1]), type: col[2].toUpperCase(), nullable: !/NOT\s+NULL|PRIMARY\s+KEY/i.test(col[3]) });
      if (/PRIMARY\s+KEY/i.test(col[3])) t.primaryKey.push(id(col[1]));
    }
    if (!t.columns.length || t.columns.length > 12) throw Error('Cada tabla debe tener entre 1 y 12 columnas para enumerar claves candidatas.');
    if (new Set(t.columns.map(c => c.name.toLowerCase())).size !== t.columns.length) throw Error('Columnas duplicadas.');
    if (t.primaryKey.some(k => !t.columns.some(c => c.name === k))) throw Error('Clave primaria con columnas inexistentes.');
    t.columns.forEach(c => { if (t.primaryKey.includes(c.name)) c.nullable = false; });
    tables.push(t); re.lastIndex = end;
  }
  if (!tables.length) throw Error('No se encontraron sentencias CREATE TABLE compatibles.');
  if (/\bALTER\s+TABLE\b/i.test(sql)) throw Error('Las restricciones ALTER TABLE no están soportadas; inclúyelas dentro de CREATE TABLE.');
  if (new Set(tables.map(t => t.name.toLowerCase())).size !== tables.length) throw Error('Tablas duplicadas.');
  return tables;
}
export function parseDependencies(text: string, table: Table): FD[] {
  const attrs = table.columns.map(c => c.name);
  return text.split('\n').map(s => s.trim()).filter(Boolean).map(line => {
    const sides = line.split(/->|→/);
    if (sides.length !== 2) throw Error('Usa una dependencia por línea: columna1, columna2 -> columna3');
    const left = unique(names(sides[0])), right = unique(names(sides[1]));
    if ([...left, ...right].some(c => !attrs.includes(c))) throw Error('Dependencia con columnas desconocidas: ' + line);
    return { left, right };
  });
}
export function closure(attrs: string[], fds: FD[]): string[] {
  const result = unique(attrs); let changed = true;
  while (changed) { changed = false; for (const f of fds) if (subset(f.left, result)) for (const a of f.right) if (!result.includes(a)) { result.push(a); changed = true; } }
  return result;
}
export function candidateKeys(attrs: string[], fds: FD[]): string[][] {
  if (attrs.length > 12) throw Error('Máximo 12 atributos por relación.');
  const keys: string[][] = [];
  for (let size = 0; size <= attrs.length; size++) for (let mask = 0; mask < 2 ** attrs.length; mask++) {
    const k = attrs.filter((_, i) => mask & 2 ** i);
    if (k.length === size && !keys.some(x => subset(x, k)) && subset(attrs, closure(k, fds))) keys.push(k);
  }
  return keys;
}
export function cover(fds: FD[]): FD[] {
  let fs = fds.flatMap(f => f.right.filter(a => !f.left.includes(a)).map(a => ({ left: [...f.left], right: [a] })));
  for (const f of fs) for (const a of [...f.left]) { const smaller = f.left.filter(x => x !== a); if (subset(f.right, closure(smaller, fs))) f.left = smaller; }
  for (let i = fs.length - 1; i >= 0; i--) if (subset(fs[i].right, closure(fs[i].left, fs.filter((_, j) => i !== j)))) fs.splice(i, 1);
  return fs;
}
export function dependencies(table: Table, explicit: FD[]): FD[] {
  return cover([...explicit, ...(table.primaryKey.length ? [{ left: table.primaryKey, right: table.columns.map(c => c.name) }] : [])]);
}
export function analyze(table: Table, fds: FD[], atomic: boolean) {
  const attrs = table.columns.map(c => c.name), keys = candidateKeys(attrs, fds), prime = unique(keys.flat());
  // Enumerate implied dependencies as violations can be absent from the input cover.
  const partial: FD[] = [], transitive: FD[] = [];
  for (let mask = 1; mask < 2 ** attrs.length; mask++) {
    const left = attrs.filter((_, i) => mask & 2 ** i), cl = closure(left, fds);
    if (subset(attrs, cl)) continue;
    const right = cl.filter(a => !left.includes(a) && !prime.includes(a));
    if (!right.length) continue;
    transitive.push({ left, right });
    if (keys.some(k => left.length < k.length && subset(left, k))) partial.push({ left, right });
  }
  return { keys, partial, transitive, form: !atomic ? 'Sin confirmar 1FN' : partial.length ? '1FN' : transitive.length ? '2FN' : '3FN' };
}
function projection(attrs: string[], fds: FD[]): FD[] {
  const out: FD[] = [];
  for (let mask = 1; mask < 2 ** attrs.length; mask++) { const left = attrs.filter((_, i) => mask & 2 ** i); const right = closure(left, fds).filter(a => attrs.includes(a) && !left.includes(a)); if (right.length) out.push({ left, right }); }
  return cover(out);
}
export function normalize(table: Table, fds: FD[], target: '2FN' | '3FN'): Table[] {
  const attrs = table.columns.map(c => c.name); let groups: string[][];
  if (target === '3FN') {
    const grouped = new Map<string, string[]>();
    for (const f of cover(fds)) { const k = [...f.left].sort().join('\0'); grouped.set(k, unique([...(grouped.get(k) || f.left), ...f.right])); }
    groups = [...grouped.values()];
    const keys = candidateKeys(attrs, fds);
    if (!groups.some(g => keys.some(k => subset(k, g)))) groups.push(keys[0]);
    groups = groups.filter((g, i) => !groups.some((h, j) => i !== j && subset(g, h) && (g.length < h.length || j < i)));
  } else {
    groups = [attrs];
    for (let i = 0; i < groups.length; i++) {
      const g = groups[i], projected = projection(g, fds);
      const temp = { ...table, columns: table.columns.filter(c => g.includes(c.name)) };
      const violation = analyze(temp, projected, true).partial[0];
      if (violation) { groups.splice(i, 1, unique([...violation.left, ...violation.right]), g.filter(a => !violation.right.includes(a))); i--; }
    }
  }
  const result = groups.map((g, i) => ({ name: `${table.name.replace(/\./g, '_')}_${target}_${i + 1}`, columns: table.columns.filter(c => g.includes(c.name)).map(c => ({ ...c })), primaryKey: candidateKeys(g, projection(g, fds))[0], foreignKeys: [] as ForeignKey[] }));
  for (const t of result) {
    t.columns.forEach(c => { if (t.primaryKey.includes(c.name)) c.nullable = false; });
    for (const other of result) if (t !== other && subset(other.primaryKey, t.columns.map(c => c.name))) t.foreignKeys.push({ columns: other.primaryKey, table: other.name, references: other.primaryKey });
  }
  return result;
}
const q = (s: string) => '[' + s.replace(/]/g, ']]') + ']';
const qTable = (s: string) => s.split('.').map(q).join('.');
export function exportSQL(tables: Table[]): string {
  return '-- SQL Server: esquema vacío. Revisar antes de ejecutar; no migra datos.\n\n' + tables.map(t => `CREATE TABLE ${qTable(t.name)} (\n${[...t.columns.map(c => `  ${q(c.name)} ${c.type} ${c.nullable ? 'NULL' : 'NOT NULL'}`), ...(t.primaryKey.length ? [`  PRIMARY KEY (${t.primaryKey.map(q).join(', ')})`] : [])].join(',\n')}\n);`).join('\n\n') + '\n\n' + tables.flatMap(t => t.foreignKeys.map(f => `ALTER TABLE ${qTable(t.name)} ADD FOREIGN KEY (${f.columns.map(q).join(', ')}) REFERENCES ${qTable(f.table)} (${f.references.map(q).join(', ')});`)).join('\n');
}
export function exportMermaid(tables: Table[]): string {
  const safe = (s: string) => s.replace(/[^a-zA-Z0-9_]/g, '_');
  return 'erDiagram\n' + tables.map(t => `  ${safe(t.name)} {\n${t.columns.map(c => `    ${safe(c.type)} ${safe(c.name)}${t.primaryKey.includes(c.name) ? ' PK' : ''}`).join('\n')}\n  }`).join('\n') + '\n' + tables.flatMap(t => t.foreignKeys.map(f => `  ${safe(f.table)} ||--o{ ${safe(t.name)} : referencia`)).join('\n');
}
// A declared repeating group becomes child rows; data splitting is intentionally separate.
export function firstNormalForm(table: Table, group: string[]): Table[] {
  group = unique(group);
  if (!table.primaryKey.length) throw Error('1FN requiere una clave primaria declarada.');
  if (!group.length || group.some(a => !table.columns.some(c => c.name === a) || table.primaryKey.includes(a))) throw Error('Selecciona columnas existentes fuera de la clave para el grupo repetido.');
  const selected = table.columns.filter(c => group.includes(c.name));
  if (selected.some(c => c.type !== selected[0].type)) throw Error('Las columnas del grupo deben tener el mismo tipo de datos.');
  if (table.primaryKey.includes('Posicion') || table.primaryKey.includes('Valor')) throw Error('Renombra las claves Posicion o Valor antes de extraer el grupo.');
  const parent: Table = { ...table, columns: table.columns.filter(c => !group.includes(c.name)), foreignKeys: table.foreignKeys.filter(f => !f.columns.some(c => group.includes(c))) };
  const child: Table = { name: table.name.replace(/\./g, '_') + '_Valores', columns: [...table.columns.filter(c => table.primaryKey.includes(c.name)).map(c => ({...c, nullable: false})), { name: 'Posicion', type: 'INT', nullable: false }, { name: 'Valor', type: selected[0].type, nullable: false }], primaryKey: [...table.primaryKey, 'Posicion'], foreignKeys: [{ columns: table.primaryKey, table: table.name, references: table.primaryKey }] };
  return [parent, child];
}
export function exportSVG(tables: Table[]): string {
  const esc = (s: string) => s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]!));
  const width = 960, rowHeight = Math.max(210, ...tables.map(t => 80 + t.columns.length * 25)), height = Math.max(250, Math.ceil(tables.length / 2) * rowHeight + 60);
  const pos = tables.map((_, i) => ({x: 30 + (i % 2) * 500, y: 30 + Math.floor(i / 2) * rowHeight}));
  const edges = tables.flatMap((t,i) => t.foreignKeys.map(f => {
    const j = tables.findIndex(o => o.name === f.table); if (j < 0) return '';
    const a = pos[i], b = pos[j];
    const x1=a.x+190,y1=a.y+45+t.columns.length*25,x2=b.x+190,y2=b.y;
    return `<path d="M ${x1} ${y1} C ${x1} ${y1+35}, ${x2} ${y2-35}, ${x2} ${y2}" fill="none" stroke="#528a70" stroke-width="2" marker-end="url(#arrow)"/><text x="${x1+6}" y="${y1+15}" font-size="10" fill="#17664f">N</text><text x="${x2+6}" y="${y2-8}" font-size="10" fill="#17664f">1</text>`;
  })).join('');
  const nodes = tables.map((t,i) => {const {x,y}=pos[i]; return `<g><rect x="${x}" y="${y}" width="380" height="${45+t.columns.length*25}" rx="8" fill="white" stroke="#8ab39b"/><rect x="${x+1}" y="${y+1}" width="378" height="35" rx="7" fill="#e3f1e8"/><text x="${x+12}" y="${y+23}" font-size="12" font-weight="bold">${esc(t.name)}</text>${t.columns.map((c,k)=>`<text x="${x+12}" y="${y+57+k*25}" font-size="12">${t.primaryKey.includes(c.name)?'◆ ':''}${esc(c.name)}</text><text x="${x+250}" y="${y+57+k*25}" font-size="10" fill="#64776b">${esc(c.type)}</text>`).join('')}</g>`;}).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Diagrama entidad relación"><defs><marker id="arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" fill="#528a70"/></marker></defs><rect width="100%" height="100%" fill="#f8fbf9"/><g font-family="monospace" fill="#234d37">${edges}${nodes}</g></svg>`;
}
