import { spawnSync } from 'node:child_process';
import { projectRoot, sqlglotPython } from './python-runtime';
const result = spawnSync(
  sqlglotPython(),
  ['-X', 'utf8', '-m', 'unittest', 'discover', '-s', 'python', '-p', 'test_*.py'],
  { cwd: projectRoot, stdio: 'inherit' },
);
if (result.error) console.error('No se pudo iniciar Python. Ejecuta npm run setup:sql.');
process.exitCode = result.status ?? 1;
