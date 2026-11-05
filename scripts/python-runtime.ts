import { resolve } from 'node:path';

export const projectRoot = resolve(__dirname, '..');

/** Windows crea Scripts/python.exe; Linux y macOS crean bin/python. */
export function virtualenvPython(platform = process.platform) {
  return resolve(projectRoot, '.venv', platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
}

export function sqlglotPython() {
  return process.env['SQLGLOT_PYTHON'] || virtualenvPython();
}
