import { MAX_FILE_BYTES, Table } from './models';
import { importSQL } from './sql/parser';
import { analyze, dependencies, parseDependencies } from './relational';
import { normalize } from './decomposition';
import { firstNormalForm } from './first-normal-form';
export type Job =
  | { type: 'import'; sql?: string; file?: File }
  | {
      type: 'normalize';
      table: Table;
      rules: string;
      target: '1FN' | '2FN' | '3FN';
      group: string[];
    };
export async function executeJob(job: Job) {
  if (job.type === 'import') {
    let sql = job.sql || '';
    if (job.file) {
      if (job.file.size > MAX_FILE_BYTES) throw Error('El límite es de 50 MiB por archivo.');
      const bytes = new Uint8Array(await job.file.arrayBuffer());
      const encoding =
        bytes[0] === 255 && bytes[1] === 254
          ? 'utf-16le'
          : bytes[0] === 254 && bytes[1] === 255
            ? 'utf-16be'
            : 'utf-8';
      try {
        sql = new TextDecoder(encoding, { fatal: true }).decode(bytes);
      } catch {
        throw Error('Codificación no reconocida. Guarda el archivo como UTF-8 o UTF-16 con BOM.');
      }
    } else if (new Blob([sql]).size > MAX_FILE_BYTES) throw Error('El límite es de 50 MiB.');
    const result = importSQL(sql);
    if (!result.tables.length)
      throw Error(result.diagnostics[0]?.message || 'No se encontraron CREATE TABLE compatibles.');
    return result;
  }
  if (job.table.issues?.length)
    throw Error('Revisa esta tabla antes de normalizar: ' + job.table.issues.join(' '));
  if (job.target === '1FN') return { report: null, results: firstNormalForm(job.table, job.group) };
  const rules = dependencies(job.table, parseDependencies(job.rules, job.table));
  return {
    report: analyze(job.table, rules, true),
    results: normalize(job.table, rules, job.target),
  };
}
