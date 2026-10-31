import { spawnSync } from 'node:child_process';
import { projectRoot, virtualenvPython } from './python-runtime';

function run(command: string, args: string[]) {
  const result = spawnSync(command, args, { cwd: projectRoot, stdio: 'inherit' });
  if (result.error) throw Error(`No se pudo ejecutar ${command}: ${result.error.message}`);
  if (result.status !== 0)
    throw Error(`La instalación se detuvo (código ${result.status}). Revisa el mensaje anterior.`);
}

try {
  let python = process.env['SQLGLOT_PYTHON'];
  if (!python) {
    const candidates =
      process.platform === 'win32'
        ? [
            { command: 'py', args: ['-3'] },
            { command: 'python', args: [] },
            { command: 'python3', args: [] },
          ]
        : [
            { command: 'python3', args: [] },
            { command: 'python', args: [] },
          ];
    const launcher = candidates.find(({ command, args }) => {
      const result = spawnSync(
        command,
        [...args, '-c', 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)'],
        { timeout: 10_000, stdio: 'ignore' },
      );
      return !result.error && result.status === 0;
    });
    if (!launcher)
      throw Error(
        'No se encontró Python 3.10 o superior. Instálalo desde https://www.python.org/downloads/, habilita el lanzador py o Add python.exe to PATH y abre una terminal nueva. Después repite npm run setup:sql.',
      );
    run(launcher.command, [...launcher.args, '-m', 'venv', '.venv']);
    python = virtualenvPython();
  }
  run(python, ['-m', 'pip', 'install', '-r', 'python/requirements.txt']);
  run(python, [
    '-X',
    'utf8',
    '-c',
    'import sqlglot; print("SQLGlot " + sqlglot.__version__ + " instalado correctamente.")',
  ]);
} catch (error) {
  console.error((error as Error).message);
  process.exitCode = 1;
}
