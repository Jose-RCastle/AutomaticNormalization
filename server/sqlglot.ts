import { projectRoot, sqlglotPython } from '../scripts/python-runtime';
import { spawn } from 'node:child_process';

/** Un proceso aislado por análisis; entrada por stdin, nunca por shell. */
export function parseWithSqlGlot(sql: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const child = spawn(sqlglotPython(), ['-X', 'utf8', 'python/sql_analysis.py'], {
      cwd: projectRoot,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let output = '',
      errors = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(Error('SQLGlot superó 60 segundos. Reduce el archivo.'));
    }, 60_000);
    child.stdout.setEncoding('utf8').on('data', (chunk) => {
      output += chunk;
      if (output.length > 20_000_000) {
        child.kill();
        reject(Error('El resultado supera el límite de tamaño.'));
      }
    });
    child.stderr.on('data', (chunk) => {
      errors = (errors + chunk).slice(-2000);
    });
    child.on('error', () => {
      clearTimeout(timer);
      reject(
        Error(
          'No se pudo iniciar Python para SQLGlot. Instala Python 3.10+ y ejecuta npm run setup:sql; después reinicia npm run dev.',
        ),
      );
    });
    child.stdin.on('error', () => {});
    child.on('close', (code) => {
      clearTimeout(timer);
      try {
        const result = JSON.parse(output);
        if (code || result.error) reject(Error(result.error || 'Error del analizador SQL.'));
        else resolve(result);
      } catch {
        reject(
          Error(
            errors.includes('No module named') && errors.includes('sqlglot')
              ? 'Python está disponible, pero falta SQLGlot. Ejecuta npm run setup:sql y reinicia npm run dev.'
              : errors
                ? 'SQLGlot no produjo un resultado válido.'
                : 'El análisis fue interrumpido.',
          ),
        );
      }
    });
    child.stdin.end(sql);
  });
}
