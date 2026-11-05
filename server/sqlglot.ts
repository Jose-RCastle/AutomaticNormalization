import { spawn } from 'node:child_process';
import { projectRoot, sqlglotPython } from '../scripts/python-runtime';
import { ParsedTable } from '../src/lib/automatic';

function python(input: string, args: string[], signal?: AbortSignal): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(Error('Análisis cancelado.'));
      return;
    }
    const child = spawn(sqlglotPython(), ['-X', 'utf8', 'python/sql_analysis.py', ...args], {
      cwd: projectRoot,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let output = '',
      settled = false;
    const finish = (error?: Error, value?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      error ? reject(error) : resolve(value);
    };
    const abort = () => {
      child.kill('SIGKILL');
      finish(Error('Análisis cancelado.'));
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(Error('El análisis excedió 60 segundos. Divide el archivo para continuar.'));
    }, 60_000);
    signal?.addEventListener('abort', abort, { once: true });
    child.stdout.setEncoding('utf8').on('data', (chunk) => {
      output += chunk;
      if (output.length > 20_000_000) {
        child.kill();
        finish(Error('El resultado excede el límite de tamaño.'));
      }
    });
    child.stderr.resume();
    child.on('error', () => finish(Error('Instala el lector SQL con npm run setup:sql.')));
    child.stdin.on('error', () => {});
    child.on('close', (code) => {
      try {
        const result = JSON.parse(output);
        finish(
          code || result.error
            ? Error(result.error || 'No se pudo interpretar el SQL.')
            : undefined,
          result,
        );
      } catch {
        finish(Error('El analizador SQL terminó sin un resultado válido.'));
      }
    });
    child.stdin.end(input);
  });
}
export function parseWithSqlGlot(
  sql: string,
  dialect = 'tsql',
  signal?: AbortSignal,
  rules?: Record<string, string>,
  defaultCollation?: string,
) {
  return python(JSON.stringify({ sql, dialect, rules, defaultCollation }), ['--request'], signal);
}
export async function profileRecords(
  table: ParsedTable,
  rows: Record<string, string | null>[],
  sampled: boolean,
  signal?: AbortSignal,
) {
  const result = (await python(
    JSON.stringify({ table, rows }),
    ['--profile'],
    signal,
  )) as NonNullable<ParsedTable['profile']> & { issues?: string[] };
  if (result.issues?.length) table.issues = result.issues;
  delete result.issues;
  result.sampled = sampled;
  if (sampled) delete result.totalRows;
  return result;
}
