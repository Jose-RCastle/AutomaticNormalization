import { Column, ImportDiagnostic, ImportResult, MAX_COLUMNS, MAX_TABLES, Table } from '../models';
import { identifier, keyword, SqlSyntaxError, Token, tokenize } from './lexer';

class Reader {
  private iterator: Generator<Token>;
  current?: Token;
  lastQualified: string[] = [];
  constructor(readonly sql: string) {
    this.iterator = tokenize(sql);
    this.next();
  }
  next() {
    const previous = this.current;
    this.current = this.iterator.next().value;
    return previous;
  }
  is(word: string) {
    return keyword(this.current, word);
  }
  take(word: string) {
    if (!this.is(word)) return false;
    this.next();
    return true;
  }
  fail(message: string): never {
    throw new SqlSyntaxError(message, this.current?.line || 1);
  }
  name(): string {
    if (!identifier(this.current)) this.fail('Se esperaba un identificador');
    return this.next()!.value;
  }
  qualified(): string {
    const parts = [this.name()];
    while (this.current?.value === '.') {
      this.next();
      parts.push(this.name());
    }
    if (parts.length > 2) this.fail('Usa nombres de tabla de una o dos partes');
    this.lastQualified = parts;
    return parts.join('.');
  }
  group(): Token[] {
    if (this.current?.value !== '(') this.fail('Se esperaba un paréntesis');
    this.next();
    const tokens: Token[] = [];
    let depth = 1;
    while (this.current) {
      const token = this.next()!;
      if (token.kind === 'symbol' && token.value === '(') depth++;
      if (token.kind === 'symbol' && token.value === ')') depth--;
      if (!depth) return tokens;
      tokens.push(token);
      if (tokens.length > 200_000) this.fail('Definición de tabla demasiado compleja');
    }
    this.fail('Paréntesis sin cerrar');
  }
}
const same = (a: string, b: string) => a.toLocaleLowerCase() === b.toLocaleLowerCase();
function split(tokens: Token[]): Token[][] {
  const groups: Token[][] = [[]];
  let depth = 0;
  for (const token of tokens) {
    if (token.kind === 'symbol' && token.value === '(') depth++;
    if (token.kind === 'symbol' && token.value === ')') depth--;
    if (token.kind === 'symbol' && token.value === ',' && depth === 0) groups.push([]);
    else groups.at(-1)!.push(token);
  }
  return groups;
}
function list(tokens: Token[], from: number): string[] {
  const start = tokens.findIndex((t, i) => i >= from && t.value === '(');
  if (start < 0)
    throw new SqlSyntaxError('Falta la lista de columnas de la clave', tokens[0]?.line || 1);
  let end = start + 1;
  while (end < tokens.length && tokens[end].value !== ')') end++;
  return split(tokens.slice(start + 1, end)).map((part) => {
    if (
      !identifier(part[0]) ||
      (part.length > 1 && !keyword(part[1], 'ASC') && !keyword(part[1], 'DESC'))
    )
      throw new SqlSyntaxError('Lista de clave inválida', part[0]?.line || 1);
    return part[0].value;
  });
}
function raw(sql: string, tokens: Token[]) {
  return tokens.length ? sql.slice(tokens[0].start, tokens.at(-1)!.end) : '';
}
function constraint(tokens: Token[], table: Table, diagnostics: ImportDiagnostic[]): void {
  if (keyword(tokens[0], 'CONSTRAINT')) tokens = tokens.slice(2);
  const warn = (message: string) =>
    diagnostics.push({ level: 'warning', message, line: tokens[0]?.line || 1, table: table.name });
  if (keyword(tokens[0], 'PRIMARY') && keyword(tokens[1], 'KEY')) {
    if (table.primaryKey.length) throw new SqlSyntaxError('Más de una PRIMARY KEY', tokens[0].line);
    table.primaryKey = list(tokens, 2);
  } else if (keyword(tokens[0], 'UNIQUE')) (table.uniqueKeys ||= []).push(list(tokens, 1));
  else if (keyword(tokens[0], 'FOREIGN') && keyword(tokens[1], 'KEY')) {
    const ref = tokens.findIndex((t) => keyword(t, 'REFERENCES'));
    if (ref < 0) throw new SqlSyntaxError('FOREIGN KEY sin REFERENCES', tokens[0].line);
    let i = ref + 1;
    const parts: string[] = [];
    while (identifier(tokens[i])) {
      parts.push(tokens[i++].value);
      if (tokens[i]?.value !== '.') break;
      i++;
    }
    table.foreignKeys.push({
      columns: list(tokens, 2),
      table: parts.join('.'),
      references: list(tokens, i),
    });
    if (tokens.some((t) => keyword(t, 'CASCADE') || keyword(t, 'SET')))
      warn('Las acciones ON DELETE/UPDATE no se trasladan al esquema normalizado.');
  } else if (keyword(tokens[0], 'CHECK') || keyword(tokens[0], 'DEFAULT'))
    warn('Restricción CHECK/DEFAULT de tabla omitida del modelo de normalización.');
  else {
    warn('Restricción no interpretada; revisa esta tabla antes de normalizar.');
    (table.issues ||= []).push('Restricción no interpretada.');
  }
}
function column(tokens: Token[], table: Table, sql: string, diagnostics: ImportDiagnostic[]) {
  const name = tokens[0]?.value;
  if (!identifier(tokens[0]) || !identifier(tokens[1]))
    throw new SqlSyntaxError('Columna sin nombre o tipo', tokens[0]?.line || 1);
  if (keyword(tokens[1], 'AS')) {
    table.columns.push({ name, type: 'NVARCHAR(MAX)', nullable: true, computed: true });
    (table.issues ||= []).push(
      `La columna calculada ${name} necesita un tipo explícito para normalizar.`,
    );
    diagnostics.push({
      level: 'warning',
      message: `Columna calculada ${name}: se muestra, pero bloquea la transformación hasta revisar su tipo.`,
      line: tokens[0].line,
      table: table.name,
    });
    return;
  }
  let end = 2;
  while (tokens[end]?.value === '.' && identifier(tokens[end + 1])) end += 2;
  if (tokens[end]?.value === '(') {
    let depth = 0;
    do {
      if (tokens[end].value === '(') depth++;
      if (tokens[end].value === ')') depth--;
      end++;
    } while (end < tokens.length && depth);
  }
  const type = raw(sql, tokens.slice(1, end)).toUpperCase();
  const rest = tokens.slice(end),
    col: Column = { name, type, nullable: true };
  const warn = (message: string, line: number) =>
    diagnostics.push({ level: 'warning', message, line, table: table.name });
  const endGroup = (start: number) => {
    if (rest[start]?.value !== '(') return start;
    let depth = 0;
    for (let j = start; j < rest.length; j++) {
      if (rest[j].value === '(') depth++;
      if (rest[j].value === ')' && --depth === 0) return j + 1;
    }
    return rest.length;
  };
  let i = 0;
  while (i < rest.length) {
    const token = rest[i];
    if (keyword(token, 'CONSTRAINT')) {
      i += 2;
      continue;
    }
    if (keyword(token, 'NOT') && keyword(rest[i + 1], 'NULL')) {
      col.nullable = false;
      i += 2;
      continue;
    }
    if (keyword(token, 'NULL')) {
      i++;
      continue;
    }
    if (keyword(token, 'PRIMARY') && keyword(rest[i + 1], 'KEY')) {
      if (table.primaryKey.length) throw new SqlSyntaxError('Más de una PRIMARY KEY', token.line);
      table.primaryKey = [name];
      col.nullable = false;
      i += 2;
      if (keyword(rest[i], 'CLUSTERED') || keyword(rest[i], 'NONCLUSTERED')) i++;
      continue;
    }
    if (keyword(token, 'UNIQUE')) {
      (table.uniqueKeys ||= []).push([name]);
      i++;
      continue;
    }
    if (keyword(token, 'IDENTITY')) {
      const end = endGroup(i + 1);
      col.identity = end > i + 1 ? raw(sql, rest.slice(i, end)) : 'IDENTITY(1,1)';
      i = end;
      continue;
    }
    if (keyword(token, 'DEFAULT')) {
      warn(`${name}: DEFAULT no se traslada a relaciones nuevas.`, token.line);
      i++;
      if (rest[i]?.value === '(') i = endGroup(i);
      else {
        // Una expresión DEFAULT puede contener funciones o cadenas con palabras reservadas.
        while (
          i < rest.length &&
          !['CONSTRAINT', 'NOT', 'NULL', 'PRIMARY', 'UNIQUE', 'REFERENCES', 'CHECK'].some((k) =>
            keyword(rest[i], k),
          )
        ) {
          if (rest[i].value === '(') i = endGroup(i);
          else i++;
        }
      }
      continue;
    }
    if (keyword(token, 'CHECK')) {
      warn(`${name}: CHECK no se traslada al esquema normalizado.`, token.line);
      i = endGroup(i + 1);
      continue;
    }
    if (keyword(token, 'COLLATE')) {
      warn(`${name}: revisa COLLATE antes de desplegar.`, token.line);
      i += 2;
      continue;
    }
    if (keyword(token, 'REFERENCES')) {
      constraint(
        [
          { ...token, value: 'FOREIGN', kind: 'word' },
          { ...token, value: 'KEY', kind: 'word' },
          { ...token, value: '(', kind: 'symbol' },
          { ...tokens[0] },
          { ...token, value: ')', kind: 'symbol' },
          ...rest.slice(i),
        ],
        table,
        diagnostics,
      );
      // REFERENCES ocupa el resto de los modificadores habituales de una columna.
      i = rest.length;
      continue;
    }
    if (['ROWGUIDCOL', 'SPARSE', 'PERSISTED'].some((k) => keyword(token, k))) {
      warn(`${name}: atributo ${token.value} omitido.`, token.line);
      i++;
      continue;
    }
    const issue = `${name}: modificador no interpretado «${token.value}».`;
    (table.issues ||= []).push(issue);
    warn(issue, token.line);
    break;
  }
  table.columns.push(col);
}

/** Lee DDL sin ejecutarlo. Los errores de una tabla no ocultan las demás. */
export function importSQL(sql: string): ImportResult {
  const tables: Table[] = [],
    diagnostics: ImportDiagnostic[] = [];
  let ignoredStatements = 0;
  const pending: { name: string; tokens: Token[]; line: number }[] = [];
  const r = new Reader(sql);
  while (r.current) {
    if (r.take('CREATE')) {
      if (r.take('OR')) r.take('ALTER');
      if (!r.take('TABLE')) {
        ignoredStatements++;
        if (['PROCEDURE', 'PROC', 'FUNCTION', 'TRIGGER', 'VIEW'].some((k) => r.is(k))) {
          diagnostics.push({
            level: 'warning',
            message:
              'Módulo omitido hasta GO: no se interpreta el SQL dentro de vistas, funciones, procedimientos o triggers.',
            line: r.current?.line || 1,
          });
          while (r.current && !r.is('GO')) r.next();
        }
        continue;
      }
      if (tables.length >= MAX_TABLES) throw Error(`Máximo ${MAX_TABLES} tablas por importación.`);
      let name = '';
      const line = r.current?.line || 1;
      try {
        name = r.qualified();
        const sqlName = [...r.lastQualified];
        const body = r.group();
        const table: Table = {
          name,
          sqlName,
          columns: [],
          primaryKey: [],
          foreignKeys: [],
          uniqueKeys: [],
        };
        for (const part of split(body)) {
          if (!part.length) throw new SqlSyntaxError('Definición vacía en CREATE TABLE', line);
          if (
            ['CONSTRAINT', 'PRIMARY', 'FOREIGN', 'UNIQUE', 'CHECK'].some((k) => keyword(part[0], k))
          )
            constraint(part, table, diagnostics);
          else column(part, table, sql, diagnostics);
        }
        if (!table.columns.length || table.columns.length > MAX_COLUMNS)
          throw new SqlSyntaxError(`Admite entre 1 y ${MAX_COLUMNS} columnas`, line);
        if (tables.some((t) => same(t.name, name)))
          throw new SqlSyntaxError('Nombre de tabla duplicado', line);
        if (new Set(table.columns.map((c) => c.name.toLowerCase())).size !== table.columns.length)
          throw new SqlSyntaxError('Columnas duplicadas', line);
        tables.push(table);
      } catch (e) {
        diagnostics.push({
          level: 'error',
          message: (e as Error).message,
          line,
          table: name || undefined,
        });
      }
    } else if (r.take('ALTER')) {
      if (!r.take('TABLE')) {
        ignoredStatements++;
        continue;
      }
      const line = r.current?.line || 1;
      try {
        const name = r.qualified();
        if (r.take('WITH')) {
          if (!r.take('NOCHECK')) r.take('CHECK');
        }
        const action = r.next();
        const tokens: Token[] = [];
        while (
          r.current &&
          r.current.value !== ';' &&
          !['GO', 'CREATE', 'ALTER', 'INSERT', 'SET', 'USE', 'EXEC'].some((k) => r.is(k))
        ) {
          tokens.push(r.next()!);
          if (tokens.length > 200_000) r.fail('ALTER TABLE demasiado complejo');
        }
        if (keyword(action, 'ADD')) pending.push({ name, tokens, line });
        else if (keyword(action, 'CHECK') || keyword(action, 'NOCHECK'))
          diagnostics.push({
            level: 'warning',
            message: 'Se omite la activación/desactivación de restricciones.',
            line,
            table: name,
          });
        else {
          pending.push({ name, tokens: [], line });
          diagnostics.push({
            level: 'warning',
            message:
              'ALTER COLUMN/DROP u otra modificación no soportada: la tabla se bloqueará para evitar un diagnóstico incorrecto.',
            line,
            table: name,
          });
        }
      } catch (e) {
        diagnostics.push({ level: 'error', message: (e as Error).message, line });
      }
    } else if (r.take('DROP')) {
      if (r.take('TABLE')) {
        if (r.take('IF')) r.take('EXISTS');
        const name = r.qualified();
        pending.push({ name, tokens: [], line: r.current?.line || 1 });
        diagnostics.push({
          level: 'error',
          message:
            'DROP TABLE no se aplica al modelo. Revisa el script para importar solo el esquema final.',
          line: r.current?.line || 1,
          table: name,
        });
      }
    } else {
      if (['INSERT', 'UPDATE', 'DELETE', 'EXEC', 'USE', 'SET'].some((k) => r.is(k)))
        ignoredStatements++;
      r.next();
    }
  }
  for (const p of pending) {
    const table = tables.find(
      (t) => same(t.name, p.name) || (!p.name.includes('.') && same(t.name, 'dbo.' + p.name)),
    );
    if (!table) {
      diagnostics.push({
        level: 'error',
        message: 'ALTER TABLE hace referencia a una tabla no importada.',
        line: p.line,
        table: p.name,
      });
      continue;
    }
    try {
      if (!p.tokens.length) throw Error('Modificación de estructura no interpretada.');
      for (const part of split(p.tokens)) {
        if (
          ['CONSTRAINT', 'PRIMARY', 'FOREIGN', 'UNIQUE', 'CHECK', 'DEFAULT'].some((k) =>
            keyword(part[0], k),
          )
        )
          constraint(part, table, diagnostics);
        else column(part, table, sql, diagnostics);
      }
    } catch (e) {
      (table.issues ||= []).push((e as Error).message);
      diagnostics.push({
        level: 'error',
        message: (e as Error).message,
        line: p.line,
        table: table.name,
      });
    }
  }
  for (const table of tables) {
    if (
      table.columns.length > MAX_COLUMNS ||
      new Set(table.columns.map((column) => column.name.toLowerCase())).size !==
        table.columns.length
    ) {
      const message = `Columnas duplicadas o más de ${MAX_COLUMNS} columnas después de ALTER TABLE.`;
      (table.issues ||= []).push(message);
      diagnostics.push({ level: 'error', message, line: 1, table: table.name });
    }

    const resolve = (name: string) => table.columns.find((c) => same(c.name, name))?.name;
    const keys = [
      table.primaryKey,
      ...(table.uniqueKeys || []),
      ...table.foreignKeys.map((f) => f.columns),
    ];
    for (const key of keys) {
      if (
        key.some((c) => !resolve(c)) ||
        new Set(key.map((c) => c.toLowerCase())).size !== key.length
      ) {
        const issue = 'Clave con columnas inexistentes o duplicadas.';
        (table.issues ||= []).push(issue);
        diagnostics.push({ level: 'error', message: issue, line: 1, table: table.name });
      } else key.splice(0, key.length, ...key.map((c) => resolve(c)!));
    }
    table.columns.forEach((c) => {
      if (table.primaryKey.includes(c.name)) c.nullable = false;
    });
    for (const fk of table.foreignKeys) {
      const target = tables.find(
        (t) =>
          same(t.name, fk.table) || (!fk.table.includes('.') && same(t.name, 'dbo.' + fk.table)),
      );
      if (target) {
        fk.table = target.name;
        fk.references = fk.references.map(
          (name) => target.columns.find((c) => same(c.name, name))?.name || name,
        );
        if (
          fk.columns.length !== fk.references.length ||
          fk.references.some((c) => !target.columns.some((col) => col.name === c))
        ) {
          (table.issues ||= []).push('Referencia foránea inválida.');
          diagnostics.push({
            level: 'error',
            message: 'Referencia foránea inválida.',
            line: 1,
            table: table.name,
          });
        }
      } else
        diagnostics.push({
          level: 'warning',
          message: `Referencia externa: ${fk.table} no está en este archivo.`,
          line: 1,
          table: table.name,
        });
    }
  }
  return { tables, diagnostics, ignoredStatements };
}
export function parseSQL(sql: string): Table[] {
  const result = importSQL(sql);
  const error = result.diagnostics.find((d) => d.level === 'error');
  if (error) throw Error(error.message);
  if (!result.tables.length) throw Error('No se encontraron sentencias CREATE TABLE compatibles.');
  return result.tables;
}
