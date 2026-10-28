/** Un lector incremental evita guardar millones de tokens de los INSERT. */
export interface Token {
  value: string;
  kind: 'word' | 'identifier' | 'string' | 'symbol';
  line: number;
  start: number;
  end: number;
}
export class SqlSyntaxError extends Error {
  constructor(
    message: string,
    public readonly line: number,
  ) {
    super(`${message} (línea ${line}).`);
  }
}
export function* tokenize(sql: string): Generator<Token> {
  let i = 0,
    line = 1;
  while (i < sql.length) {
    const c = sql[i],
      next = sql[i + 1];
    if (/\s|\uFEFF/.test(c)) {
      if (c === '\n') line++;
      i++;
      continue;
    }
    if (c === '-' && next === '-') {
      while (i < sql.length && sql[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && next === '*') {
      const from = line;
      let depth = 1;
      i += 2;
      while (i < sql.length && depth) {
        if (sql[i] === '/' && sql[i + 1] === '*') {
          depth++;
          i += 2;
        } else if (sql[i] === '*' && sql[i + 1] === '/') {
          depth--;
          i += 2;
        } else {
          if (sql[i] === '\n') line++;
          i++;
        }
      }
      if (depth) throw new SqlSyntaxError('Comentario sin cerrar', from);
      continue;
    }
    const start = i,
      from = line;
    if (c === '[' || c === '"' || c === "'") {
      const close = c === '[' ? ']' : c;
      let value = '';
      i++;
      let closed = false;
      while (i < sql.length) {
        if (sql[i] === close) {
          if (sql[i + 1] === close) {
            value += close;
            i += 2;
            continue;
          }
          i++;
          closed = true;
          break;
        }
        if (sql[i] === '\n') line++;
        value += sql[i++];
      }
      if (!closed) throw new SqlSyntaxError('Literal o identificador sin cerrar', from);
      yield { value, kind: c === "'" ? 'string' : 'identifier', line: from, start, end: i };
    } else if (/[\p{L}\p{N}_@$#]/u.test(c)) {
      while (i < sql.length && /[\p{L}\p{N}_@$#]/u.test(sql[i])) i++;
      yield { value: sql.slice(start, i), kind: 'word', line: from, start, end: i };
    } else {
      i++;
      yield { value: c, kind: 'symbol', line: from, start, end: i };
    }
  }
}
export const keyword = (token: Token | undefined, word: string) =>
  token?.kind === 'word' && token.value.toUpperCase() === word;
export const identifier = (token: Token | undefined) =>
  token && (token.kind === 'word' || token.kind === 'identifier');
